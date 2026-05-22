import cv2
import time
import uuid
import threading
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from camera.capture import CameraCapture
from camera.motion import MotionDetector
from detection.detector import ObjectDetector, CATEGORY_COLORS_BGR
from notifications.dispatcher import dispatch_notification
from config.settings import get_settings
from storage.manager import get_active_images_dir
import sqlite3

cfg = get_settings()

# Seconds of silence before a new detection is treated as a fresh event.
# Prevents duplicate DB records and notification spam for the same continuous presence.
COOLDOWN_SECS = 0.5      # how often YOLO runs while motion is present
YOLO_TIMEOUT_SECS = 20  # skip a YOLO call if inference hasn't returned in this many seconds
SCREENSHOT_INTERVAL = 5  # seconds between screenshots saved per active event
EVENT_GAP = 30           # seconds of silence before an event is considered closed
CLEAR_DETECTIONS_SECS = 5   # clear overlay N secs after motion stops completely
STUCK_MOTION_SECS = 120     # auto-reset motion detector after N secs of continuous motion

_MOTION_OVERLAP_THRESHOLD = 0.05


def _detect_with_timeout(detector, frame):
    """Run detector.detect in a daemon thread; returns [] on timeout so the
    camera loop continues rather than blocking indefinitely on a stuck model."""
    result = [None]
    done = threading.Event()

    def _worker():
        try:
            result[0] = detector.detect(frame)
        except Exception:
            result[0] = []
        done.set()

    threading.Thread(target=_worker, daemon=True).start()
    if done.wait(timeout=YOLO_TIMEOUT_SECS):
        return result[0] or [], False
    return [], True  # timed out

def _bbox_has_motion(mask, bbox):
    x1, y1, x2, y2 = bbox
    region = mask[y1:y2, x1:x2]
    if region.size == 0:
        return False
    return (region > 0).sum() / region.size >= _MOTION_OVERLAP_THRESHOLD

def _match_detection(detection, active_events, frame_shape):
    """Return the best matching active event for a detection, or None if it's new."""
    h, w = frame_shape[:2]
    max_dist = min(w, h) * 0.4
    d_cx = (detection.bbox[0] + detection.bbox[2]) / 2
    d_cy = (detection.bbox[1] + detection.bbox[3]) / 2
    best, best_dist = None, float('inf')
    for ev in active_events:
        if ev['label'] != detection.label:
            continue
        e_cx = (ev['bbox'][0] + ev['bbox'][2]) / 2
        e_cy = (ev['bbox'][1] + ev['bbox'][3]) / 2
        dist = ((d_cx - e_cx) ** 2 + (d_cy - e_cy) ** 2) ** 0.5
        if dist < max_dist and dist < best_dist:
            best, best_dist = ev, dist
    return best

class DetectionPipeline:
    def __init__(self, cameras: list[CameraCapture], model_name: str = "yolov8n.pt", confidences: dict = None):
        self._cameras = list(cameras)
        self._detectors = {cam.camera_id: MotionDetector() for cam in cameras}
        self._object_detector = ObjectDetector(model_name, confidences=confidences)
        self._running = False
        self._threads: list[threading.Thread] = []
        self._latest_detections: dict = {}
        self._overlay_enabled: dict = {cam.camera_id: True for cam in cameras}
        self._active_events: dict = {}  # camera_id -> timestamp of last stored detection
        self._last_motion_time: dict = {}  # camera_id -> time of last frame with motion
        self._motion_start: dict = {}      # camera_id -> start of current continuous motion
        self._lock = threading.Lock()
        self._debug_stats: dict = {}   # camera_id -> live AI debug dict
        self._auto_resets: dict = {}   # camera_id -> cumulative auto-reset count
        self._yolo_timeouts: dict = {} # camera_id -> cumulative timeout count

    def start(self):
        self._running = True
        for cam in self._cameras:
            t = threading.Thread(target=self._run_camera, args=(cam,), daemon=True)
            t.start()
            self._threads.append(t)

    def stop(self):
        self._running = False

    def set_overlay(self, camera_id: int, enabled: bool):
        self._overlay_enabled[camera_id] = enabled

    def prune_dead_and_get_state(self):
        """Atomically prune dead cameras and return (existing_paths, next_id)."""
        with self._lock:
            dead = [c for c in self._cameras if not c.is_alive()]
            for c in dead:
                c.stop()
                self._cameras.remove(c)
                self._detectors.pop(c.camera_id, None)
                self._latest_detections.pop(c.camera_id, None)
                self._overlay_enabled.pop(c.camera_id, None)
                self._active_events.pop(c.camera_id, None)
            existing_paths = {cam.device_path for cam in self._cameras}
            next_id = max((c.camera_id for c in self._cameras), default=-1) + 1
        return existing_paths, next_id

    def reload_model(self, model_name: str):
        """Hot-swap the YOLO model. Creates the new model first, then swaps under lock."""
        with self._lock:
            existing_confidences = dict(self._object_detector._confidences)
        new_detector = ObjectDetector(model_name, confidences=existing_confidences)
        with self._lock:
            self._object_detector = new_detector

    def set_category_confidence(self, category: str, value: float):
        with self._lock:
            self._object_detector.set_category_confidence(category, value)

    def reset_tracking(self, camera_id: int):
        """Reset the motion detector, clear latest detections, and reset event state."""
        with self._lock:
            if camera_id in self._detectors:
                self._detectors[camera_id] = MotionDetector()
            self._latest_detections.pop(camera_id, None)
            self._active_events.pop(camera_id, None)
        self._last_motion_time.pop(camera_id, None)
        self._motion_start.pop(camera_id, None)
        self._auto_resets.pop(camera_id, None)
        self._yolo_timeouts.pop(camera_id, None)
        self._debug_stats.pop(camera_id, None)

    def reload_camera(self, camera_id: int) -> bool:
        """Stop, remove, re-probe, and re-add a camera keeping the same ID."""
        with self._lock:
            cam = next((c for c in self._cameras if c.camera_id == camera_id), None)
            if cam is None:
                return False
            device_idx = cam.device_index
            overlay = self._overlay_enabled.get(camera_id, True)
            cam.stop()
            self._cameras.remove(cam)
            self._detectors.pop(camera_id, None)
            self._latest_detections.pop(camera_id, None)
            self._overlay_enabled.pop(camera_id, None)
            self._active_events.pop(camera_id, None)
        self._last_motion_time.pop(camera_id, None)
        self._motion_start.pop(camera_id, None)
        self._auto_resets.pop(camera_id, None)
        self._yolo_timeouts.pop(camera_id, None)
        self._debug_stats.pop(camera_id, None)

        time.sleep(1.0)  # Give OS time to release the device

        new_cap = CameraCapture(camera_id=camera_id, device_index=device_idx)
        new_cap.start()
        time.sleep(0.5)

        with self._lock:
            self._cameras.append(new_cap)
            self._detectors[camera_id] = MotionDetector()
            self._overlay_enabled[camera_id] = overlay
            if self._running:
                t = threading.Thread(target=self._run_camera, args=(new_cap,), daemon=True)
                t.start()
                self._threads.append(t)
        return True

    def refresh(self, new_captures: list[CameraCapture]):
        """Remove dead cameras and add newly discovered ones. Thread-safe."""
        with self._lock:
            # Prune cameras that are no longer alive (unplugged)
            dead = [c for c in self._cameras if not c.is_alive()]
            for c in dead:
                c.stop()
                self._cameras.remove(c)
                self._detectors.pop(c.camera_id, None)
                self._latest_detections.pop(c.camera_id, None)
                self._overlay_enabled.pop(c.camera_id, None)
                self._active_events.pop(c.camera_id, None)

            # Add newly found cameras
            for cap in new_captures:
                self._cameras.append(cap)
                self._detectors[cap.camera_id] = MotionDetector()
                self._overlay_enabled[cap.camera_id] = True
                if self._running:
                    t = threading.Thread(target=self._run_camera, args=(cap,), daemon=True)
                    t.start()
                    self._threads.append(t)

    def get_latest(self, camera_id: int):
        return self._latest_detections.get(camera_id)

    def get_debug(self, camera_id: int) -> dict:
        return dict(self._debug_stats.get(camera_id, {}))

    def _debug_snapshot(self, cam_id, state, has_motion, motion_secs,
                         cooldown_remaining, last_yolo_ms, last_yolo_time, now):
        return {
            'state': state,
            'has_motion': has_motion,
            'motion_secs': round(motion_secs, 1),
            'stuck_secs': STUCK_MOTION_SECS,
            'cooldown_remaining': round(cooldown_remaining, 2),
            'last_yolo_ms': last_yolo_ms,
            'last_yolo_secs_ago': round(now - last_yolo_time, 1) if last_yolo_time else None,
            'auto_resets': self._auto_resets.get(cam_id, 0),
            'yolo_timeouts': self._yolo_timeouts.get(cam_id, 0),
            'active_detections': len(self._latest_detections.get(cam_id) or []),
        }

    def _run_camera(self, cam: CameraCapture):
        motion_detector = self._detectors[cam.camera_id]
        cooldown = 0
        last_yolo_time = None
        last_yolo_ms = None

        while self._running:
            frame_obj = cam.get_frame()
            if frame_obj is None:
                time.sleep(0.05)
                continue
            frame = frame_obj.data
            has_motion, motion_mask = motion_detector.detect(frame)
            now = time.time()

            if has_motion:
                if cam.camera_id not in self._motion_start:
                    self._motion_start[cam.camera_id] = now
                self._last_motion_time[cam.camera_id] = now
                motion_secs = now - self._motion_start[cam.camera_id]

                # Auto-reset if motion has been continuous for too long — background model is stuck
                if motion_secs > STUCK_MOTION_SECS:
                    self._auto_resets[cam.camera_id] = self._auto_resets.get(cam.camera_id, 0) + 1
                    with self._lock:
                        self._detectors[cam.camera_id] = MotionDetector()
                        self._latest_detections.pop(cam.camera_id, None)
                        self._active_events.pop(cam.camera_id, None)
                    motion_detector = self._detectors[cam.camera_id]
                    self._motion_start.pop(cam.camera_id, None)
                    self._last_motion_time.pop(cam.camera_id, None)
                    cooldown = 0
                    self._debug_stats[cam.camera_id] = self._debug_snapshot(
                        cam.camera_id, 'idle', False, 0, 0, last_yolo_ms, None, now)
                    time.sleep(0.05)
                    continue

                cooldown_remaining = max(0.0, cooldown - now)
                state = 'cooldown' if cooldown_remaining > 0 else 'motion'
                self._debug_stats[cam.camera_id] = self._debug_snapshot(
                    cam.camera_id, state, True, motion_secs, cooldown_remaining,
                    last_yolo_ms, last_yolo_time, now)

                if now > cooldown:
                    t0 = time.time()
                    with self._lock:
                        detector = self._object_detector
                    all_detections, timed_out = _detect_with_timeout(detector, frame)
                    elapsed = time.time() - t0
                    if timed_out:
                        self._yolo_timeouts[cam.camera_id] = self._yolo_timeouts.get(cam.camera_id, 0) + 1
                        cooldown = now + 5.0  # longer cooldown after a hung call
                        self._debug_stats[cam.camera_id] = self._debug_snapshot(
                            cam.camera_id, 'timeout', True, motion_secs, 5.0,
                            last_yolo_ms, last_yolo_time, now)
                        time.sleep(0.05)
                        continue
                    last_yolo_ms = round(elapsed * 1000)
                    last_yolo_time = now

                    detections = [d for d in all_detections if _bbox_has_motion(motion_mask, d.bbox)]
                    if detections:
                        self._latest_detections[cam.camera_id] = detections
                        active = self._active_events.setdefault(cam.camera_id, [])
                        screenshot_needed = []
                        for d in detections:
                            ev = _match_detection(d, active, frame.shape)
                            if ev is None:
                                ev = {
                                    'event_id': str(uuid.uuid4()),
                                    'label': d.label,
                                    'category': d.category,
                                    'bbox': d.bbox,
                                    'last_seen': now,
                                    'last_screenshot': 0,
                                    'notified': False,
                                }
                                active.append(ev)
                            else:
                                ev['bbox'] = d.bbox
                                ev['last_seen'] = now
                            if now - ev['last_screenshot'] >= SCREENSHOT_INTERVAL:
                                screenshot_needed.append((d, ev))
                        if screenshot_needed:
                            annotated = self._annotate(frame.copy(), detections)
                            ts = datetime.now(timezone.utc).isoformat()
                            img_path = self._save_image(annotated, cam.camera_id, ts, detections)
                            notify_dets = []
                            first_new_event_id = None
                            for d, ev in screenshot_needed:
                                ev['last_screenshot'] = now
                                is_new = not ev['notified']
                                ev['notified'] = True
                                self._store_detection_record(cam.camera_id, d, img_path, ts, ev['event_id'])
                                if is_new:
                                    notify_dets.append(d)
                                    if first_new_event_id is None:
                                        first_new_event_id = ev['event_id']
                            if notify_dets:
                                asyncio.run(dispatch_notification(cam.camera_id, notify_dets, img_path, ts, first_new_event_id))
                    else:
                        # Motion present but YOLO found nothing in the motion area — clear overlay
                        self._latest_detections.pop(cam.camera_id, None)
                    active = self._active_events.get(cam.camera_id, [])
                    active[:] = [ev for ev in active if now - ev['last_seen'] <= EVENT_GAP]
                    cooldown = now + COOLDOWN_SECS
                    # Refresh debug with latest YOLO stats
                    self._debug_stats[cam.camera_id] = self._debug_snapshot(
                        cam.camera_id, 'motion', True, motion_secs, 0,
                        last_yolo_ms, last_yolo_time, now)
            else:
                # No motion this frame — reset continuous motion tracker
                self._motion_start.pop(cam.camera_id, None)
                last = self._last_motion_time.get(cam.camera_id)
                if last and now - last > CLEAR_DETECTIONS_SECS:
                    self._latest_detections.pop(cam.camera_id, None)
                    self._last_motion_time.pop(cam.camera_id, None)
                self._debug_stats[cam.camera_id] = self._debug_snapshot(
                    cam.camera_id, 'idle', False, 0, 0, last_yolo_ms, last_yolo_time, now)

            time.sleep(0.05)

    def _annotate(self, frame, detections):
        for d in detections:
            x1, y1, x2, y2 = d.bbox
            color = CATEGORY_COLORS_BGR.get(d.category, (128, 128, 128))
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(frame, f"{d.label} {d.confidence:.0%}", (x1, y1 - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        return frame

    def _save_image(self, frame, camera_id, ts, detections=None):
        db = sqlite3.connect(cfg.db_path)
        tz_row = db.execute("SELECT value FROM app_config WHERE key='timezone'").fetchone()
        db.close()
        tz_name = tz_row[0] if tz_row else 'UTC'
        try:
            tz = ZoneInfo(tz_name) if tz_name != 'UTC' else timezone.utc
        except ZoneInfoNotFoundError:
            tz = timezone.utc

        dt = datetime.fromisoformat(ts).astimezone(tz)
        hour = dt.strftime('%I').lstrip('0') or '12'
        time_str = dt.strftime(f'%a %b {dt.day}, %Y  {hour}:%M %p %Z')

        if detections:
            parts = [f"{d.label}  {round(d.confidence * 100)}%" for d in detections]
            det_str = '   ·   '.join(parts)
        else:
            det_str = ''

        h, w = frame.shape[:2]
        bar_h = 36
        cv2.rectangle(frame, (0, h - bar_h), (w, h), (40, 40, 40), -1)

        font = cv2.FONT_HERSHEY_SIMPLEX
        scale, thick = 0.48, 1
        fg = (210, 210, 210)
        text_y = h - bar_h + 24

        cv2.putText(frame, time_str, (8, text_y), font, scale, fg, thick, cv2.LINE_AA)

        if det_str:
            (tw, _), _ = cv2.getTextSize(det_str, font, scale, thick)
            if tw > w // 2:
                det_str = parts[0] + (f'  +{len(parts) - 1} more' if len(parts) > 1 else '')
                (tw, _), _ = cv2.getTextSize(det_str, font, scale, thick)
            cv2.putText(frame, det_str, (w - tw - 8, text_y), font, scale, fg, thick, cv2.LINE_AA)

        safe_ts = ts.replace(":", "-").replace(".", "-")
        path = Path(get_active_images_dir()) / f"cam{camera_id}_{safe_ts}.jpg"
        path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(path), frame)
        return str(path)

    def _store_detection_record(self, camera_id, detection, image_path, ts, event_id):
        db = sqlite3.connect(cfg.db_path)
        db.execute(
            "INSERT INTO detections (camera_id, category, label, confidence, image_path, timestamp, event_id) VALUES (?,?,?,?,?,?,?)",
            (camera_id, detection.category, detection.label, detection.confidence, image_path, ts, event_id)
        )
        db.commit()
        db.close()
