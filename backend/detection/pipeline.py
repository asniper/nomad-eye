import cv2
import numpy as np
import time
import uuid
import threading
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from camera.capture import CameraCapture
from camera.motion import MotionDetector
from detection.detector import ObjectDetector, CATEGORY_COLORS_BGR, create_detector
from detection.face_recognizer import FaceRecognizer
from notifications.dispatcher import dispatch_notification
from config.settings import get_settings
from storage.manager import get_active_images_dir, get_active_clips_dir
from detection.clip_writer import ClipBuffer, EventClipWriter, CLIP_PUSH_INTERVAL
import sqlite3
import shutil as _shutil

cfg = get_settings()

# Seconds of silence before a new detection is treated as a fresh event.
# Prevents duplicate DB records and notification spam for the same continuous presence.
COOLDOWN_SECS = 3.0      # minimum gap between YOLO calls per camera while motion is present
YOLO_TIMEOUT_SECS = 120  # skip a YOLO call if inference hasn't returned in this many seconds
SCREENSHOT_INTERVAL = 5  # seconds between screenshots saved per active event
EVENT_GAP = 30           # seconds of silence before an event is considered closed
CLEAR_DETECTIONS_SECS = 5   # clear overlay N secs after motion stops completely
STUCK_MOTION_SECS = 120     # auto-reset motion detector after N secs of continuous motion
PERIODIC_SCAN_SECS = 30     # scan for stationary subjects even when there's no motion

# Only one YOLO inference at a time across all cameras.
# _yolo_in_flight stays set while a worker is running; new calls return immediately
# instead of queuing behind the semaphore, preventing a pile-up when the first
# inference is slow (e.g. PyTorch JIT warmup on ARM taking 30-60 s).
_yolo_call_lock = threading.Lock()
_yolo_in_flight = threading.Event()

def _detect_with_timeout(detector, frame):
    """Run detector.detect in a daemon thread; returns [] on timeout so the
    camera loop continues rather than blocking indefinitely on a stuck model."""
    with _yolo_call_lock:
        if _yolo_in_flight.is_set():
            return [], True  # previous call still running — skip rather than pile up
        _yolo_in_flight.set()

    result = [None]
    done = threading.Event()

    def _worker():
        try:
            result[0] = detector.detect(frame)
        except Exception:
            result[0] = []
        finally:
            _yolo_in_flight.clear()
            done.set()

    threading.Thread(target=_worker, daemon=True).start()
    if done.wait(timeout=YOLO_TIMEOUT_SECS):
        return result[0] or [], False
    return [], True  # timed out

def _bbox_has_motion(mask, bbox):
    x1, y1, x2, y2 = bbox
    region = mask[y1:y2, x1:x2]
    # Any motion pixel inside the bbox counts — low motion_threshold (e.g. 50 px)
    # means very few fg pixels relative to a large detection bbox.
    return region.size > 0 and bool((region > 0).any())

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
    if best is not None:
        return best
    # Fallback: same category + overlapping box — same physical object detected
    # under two different label names (e.g. "cat" event vs new "house cat" detection).
    for ev in active_events:
        if ev['category'] != detection.category:
            continue
        ax1, ay1, ax2, ay2 = detection.bbox
        bx1, by1, bx2, by2 = ev['bbox']
        ix1, iy1 = max(ax1, bx1), max(ay1, by1)
        ix2, iy2 = min(ax2, bx2), min(ay2, by2)
        inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
        if inter > 0:
            union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
            iou = inter / union if union > 0 else 0.0
            if iou > 0.4:
                e_cx = (bx1 + bx2) / 2
                e_cy = (by1 + by2) / 2
                dist = ((d_cx - e_cx) ** 2 + (d_cy - e_cy) ** 2) ** 0.5
                if dist < max_dist and dist < best_dist:
                    best, best_dist = ev, dist
    return best

class DetectionPipeline:
    def __init__(self, cameras: list[CameraCapture], model_name: str = "yolov8n.pt", confidences: dict = None, classes: list = None):
        self._cameras = list(cameras)
        self._motion_threshold: int = cfg.motion_threshold
        self._motion_scale: float = 0.5
        self._detection_cooldown: float = COOLDOWN_SECS
        self._detectors = {cam.camera_id: MotionDetector(threshold=self._motion_threshold, scale=self._motion_scale) for cam in cameras}
        _model_key = model_name.removesuffix('.pt') if model_name.endswith('.pt') else model_name
        self._detection_model_key: str = _model_key
        self._detection_classes: list = classes
        try:
            self._object_detector = create_detector(_model_key, classes=classes, confidences=confidences)
        except Exception:
            _model_key = 'yolov8n'
            self._detection_model_key = _model_key
            self._object_detector = ObjectDetector('yolov8n.pt', confidences=confidences)
        self._face_recognizer = FaceRecognizer()
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
        self._motion_bboxes: dict = {} # camera_id -> (x1,y1,x2,y2) of current motion region
        self._enabled_categories: set = {'people', 'vehicles', 'animals', 'other', 'faces'}
        self._face_last_run: dict = {}        # camera_id -> timestamp of last face detection
        self._face_crop_last_run: dict = {}   # camera_id -> timestamp of last targeted crop detection
        self._last_periodic_scan: dict = {}   # camera_id -> timestamp of last no-motion YOLO scan
        self._face_cam_enabled: dict = {}     # camera_id -> bool, default True
        self._face_cam_sensitivity: dict = {} # camera_id -> 'fast'|'normal'|'thorough', default 'normal'
        self._ai_enabled: bool = True
        self._video_width: int = 1280
        self._video_height: int = 720
        self._video_fps: int = 15
        # Clip recording
        self._clips_enabled: bool = False
        self._clip_pre_roll: int = 5
        self._clip_post_roll: int = 10
        self._clip_buffers: dict = {}      # camera_id -> ClipBuffer
        self._clip_writers: dict = {}      # camera_id -> {event_id -> EventClipWriter}
        self._clip_lock = threading.Lock()
        self._last_clip_push: dict = {}    # camera_id -> float

    def start(self):
        self._running = True
        for cam in self._cameras:
            t = threading.Thread(target=self._run_camera, args=(cam,), daemon=True)
            t.start()
            self._threads.append(t)
        threading.Thread(target=self._clip_closer_loop, daemon=True, name='clip-closer').start()

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
                self._cleanup_camera_clips(c.camera_id)
            existing_paths = {cam.device_path for cam in self._cameras}
            next_id = max((c.camera_id for c in self._cameras), default=-1) + 1
        return existing_paths, next_id

    def reload_model(self, model_key: str, classes: list = None):
        """Hot-swap the detection model. Creates the new model first, then swaps under lock."""
        key = model_key.removesuffix('.pt') if model_key.endswith('.pt') else model_key
        with self._lock:
            existing_confidences = dict(self._object_detector._confidences)
        new_detector = create_detector(key, classes=classes, confidences=existing_confidences)
        self._detection_model_key = key
        self._detection_classes = classes
        with self._lock:
            self._object_detector = new_detector

    def reload_faces(self):
        """Re-sync face recognizer's in-memory known faces from DB."""
        self._face_recognizer.reload()

    def set_face_confidence(self, value: float):
        self._face_recognizer.set_min_confidence(value)

    def set_camera_face_enabled(self, camera_id: int, enabled: bool):
        self._face_cam_enabled[camera_id] = enabled

    def set_camera_face_sensitivity(self, camera_id: int, sensitivity: str):
        if sensitivity in ('fast', 'normal', 'thorough'):
            self._face_cam_sensitivity[camera_id] = sensitivity

    def set_ai_enabled(self, enabled: bool):
        self._ai_enabled = enabled
        if not enabled:
            # Keep _latest_detections so overlays remain visible until motion naturally clears them.
            with self._lock:
                self._active_events.clear()
            self._motion_bboxes.clear()
        # Reload cameras so capture settings match the new mode.
        self._reload_all_cameras_bg()

    def set_video_quality(self, width: int, height: int, fps: int):
        self._video_width = width
        self._video_height = height
        self._video_fps = fps
        # Apply immediately to running cameras when AI is off (AI mode overrides quality).
        if not self._ai_enabled:
            self._reload_all_cameras_bg()

    def set_clips_config(self, enabled: bool, pre_roll: int, post_roll: int):
        was_enabled = self._clips_enabled
        self._clips_enabled = enabled
        self._clip_pre_roll = pre_roll
        self._clip_post_roll = post_roll
        if was_enabled and not enabled:
            # Drop all in-progress clips — they won't be completed
            with self._clip_lock:
                all_writers = {cid: dict(ws) for cid, ws in self._clip_writers.items()}
                self._clip_writers.clear()
            for writers in all_writers.values():
                for w in writers.values():
                    try:
                        path = w.close()
                        if path:
                            Path(path).unlink(missing_ok=True)
                    except Exception:
                        pass
            self._clip_buffers.clear()
            self._last_clip_push.clear()

    def _cleanup_camera_clips(self, camera_id: int):
        """Drop ring buffer and any in-progress writers for this camera."""
        self._clip_buffers.pop(camera_id, None)
        self._last_clip_push.pop(camera_id, None)
        with self._clip_lock:
            cam_writers = self._clip_writers.pop(camera_id, {})
        for w in cam_writers.values():
            try:
                w.close()
            except Exception:
                pass

    def _clip_closer_loop(self):
        while self._running:
            time.sleep(1.0)
            if self._clips_enabled:
                try:
                    self._close_finished_clips()
                except Exception:
                    pass

    def _close_finished_clips(self):
        to_close = []
        with self._clip_lock:
            for cam_id, writers in list(self._clip_writers.items()):
                for event_id, w in list(writers.items()):
                    if w.should_close(self._clip_post_roll):
                        to_close.append((cam_id, event_id, w))
        for cam_id, event_id, w in to_close:
            clip_path = w.close()
            with self._clip_lock:
                if cam_id in self._clip_writers:
                    self._clip_writers[cam_id].pop(event_id, None)
            if clip_path:
                threading.Thread(
                    target=self._save_clip,
                    args=(event_id, cam_id, clip_path),
                    daemon=True
                ).start()

    def _save_clip(self, event_id: str, camera_id: int, clip_path: str):
        clip_path = self._convert_to_h264(clip_path) or clip_path
        self._store_clip_record(event_id, camera_id, clip_path)
        try:
            self._auto_purge_clips()
        except Exception:
            pass

    def _convert_to_h264(self, clip_path: str) -> str | None:
        import subprocess, logging
        tmp = clip_path + '.h264tmp.mp4'
        try:
            r = subprocess.run(
                ['ffmpeg', '-i', clip_path, '-c:v', 'libx264', '-preset', 'ultrafast',
                 '-crf', '28', '-movflags', '+faststart', '-an', '-y', tmp],
                capture_output=True, timeout=180
            )
            if r.returncode == 0 and Path(tmp).exists() and Path(tmp).stat().st_size > 5000:
                Path(clip_path).unlink(missing_ok=True)
                Path(tmp).rename(clip_path)
                return clip_path
        except FileNotFoundError:
            pass  # ffmpeg not installed, use original
        except Exception as e:
            logging.getLogger(__name__).warning('H.264 conversion failed for %s: %s', clip_path, e)
        finally:
            Path(tmp).unlink(missing_ok=True)
        return None

    def _store_clip_record(self, event_id: str, camera_id: int, clip_path: str):
        import logging
        db = sqlite3.connect(cfg.db_path, timeout=10)
        try:
            ts = datetime.now(timezone.utc).isoformat()
            db.execute(
                "INSERT OR REPLACE INTO event_clips (event_id, clip_path, camera_id, created_at)"
                " VALUES (?,?,?,?)",
                (event_id, clip_path, camera_id, ts),
            )
            db.commit()
        except Exception as e:
            logging.getLogger(__name__).error("Failed to store clip record for %s: %s", event_id, e)
        finally:
            db.close()

    def _auto_purge_clips(self):
        """Delete oldest clips when storage threshold is exceeded."""
        db = sqlite3.connect(cfg.db_path)
        try:
            mode_row = db.execute("SELECT value FROM app_config WHERE key='clips_purge_mode'").fetchone()
            purge_mode = mode_row[0] if mode_row else 'pct'
            thr_row = db.execute("SELECT value FROM app_config WHERE key='clips_purge_threshold'").fetchone()
            threshold = float(thr_row[0]) if thr_row else 90.0

            clips_dir = get_active_clips_dir()
            if not clips_dir:
                return

            def _over():
                if purge_mode == 'pct':
                    try:
                        u = _shutil.disk_usage(clips_dir)
                        return (u.used / u.total * 100) > threshold
                    except Exception:
                        return False
                else:
                    rows = db.execute("SELECT clip_path FROM event_clips").fetchall()
                    total = sum(Path(r[0]).stat().st_size for r in rows if r[0] and Path(r[0]).exists())
                    return total > threshold * 1024 * 1024

            if not _over():
                return
            rows = db.execute(
                "SELECT event_id, clip_path FROM event_clips ORDER BY created_at ASC"
            ).fetchall()
            for event_id, clip_path in rows:
                if clip_path:
                    try:
                        Path(clip_path).unlink(missing_ok=True)
                    except Exception:
                        pass
                db.execute("DELETE FROM event_clips WHERE event_id=?", (event_id,))
                db.commit()
                if not _over():
                    break
        finally:
            db.close()

    def _reload_all_cameras_bg(self):
        """Reload all cameras in a background thread so the caller is never blocked."""
        cam_ids = [c.camera_id for c in list(self._cameras)]
        def _do():
            for cid in cam_ids:
                try:
                    self.reload_camera(cid)
                except Exception:
                    pass
        threading.Thread(target=_do, daemon=True).start()

    def _camera_quality(self):
        """Returns (width, height, fps) — AI-optimal when AI is on, user setting otherwise."""
        if self._ai_enabled:
            return 1280, 720, 15
        return self._video_width, self._video_height, self._video_fps

    def set_category_enabled(self, category: str, enabled: bool):
        if enabled:
            self._enabled_categories.add(category)
        else:
            self._enabled_categories.discard(category)

    def set_category_confidence(self, category: str, value: float):
        with self._lock:
            self._object_detector.set_category_confidence(category, value)

    def set_motion_threshold(self, value: int):
        self._motion_threshold = value
        with self._lock:
            for cam_id, det in self._detectors.items():
                det._threshold = value

    def set_motion_scale(self, scale: float):
        self._motion_scale = max(0.25, min(1.0, scale))
        with self._lock:
            for cam_id in list(self._detectors.keys()):
                self._detectors[cam_id] = MotionDetector(
                    threshold=self._motion_threshold, scale=self._motion_scale)

    def set_detection_cooldown(self, secs: float):
        self._detection_cooldown = max(0.5, float(secs))

    def reset_tracking(self, camera_id: int):
        """Reset the motion detector, clear latest detections, and reset event state."""
        with self._lock:
            if camera_id in self._detectors:
                self._detectors[camera_id] = MotionDetector(threshold=self._motion_threshold, scale=self._motion_scale)
            self._latest_detections.pop(camera_id, None)
            self._active_events.pop(camera_id, None)
        self._last_motion_time.pop(camera_id, None)
        self._motion_start.pop(camera_id, None)
        self._motion_bboxes.pop(camera_id, None)
        self._auto_resets.pop(camera_id, None)
        self._yolo_timeouts.pop(camera_id, None)
        self._debug_stats.pop(camera_id, None)
        self._cleanup_camera_clips(camera_id)

    def disable_camera(self, camera_id: int):
        """Stop and remove a camera from the active pipeline without deleting its DB record."""
        with self._lock:
            cam = next((c for c in self._cameras if c.camera_id == camera_id), None)
            if cam is None:
                return
            cam.stop()
            self._cameras.remove(cam)
            self._detectors.pop(camera_id, None)
            self._latest_detections.pop(camera_id, None)
            self._overlay_enabled.pop(camera_id, None)
            self._active_events.pop(camera_id, None)
        self._last_motion_time.pop(camera_id, None)
        self._motion_start.pop(camera_id, None)
        self._motion_bboxes.pop(camera_id, None)
        self._auto_resets.pop(camera_id, None)
        self._yolo_timeouts.pop(camera_id, None)
        self._debug_stats.pop(camera_id, None)
        self._face_last_run.pop(camera_id, None)
        self._face_crop_last_run.pop(camera_id, None)
        self._cleanup_camera_clips(camera_id)

    def enable_camera(self, camera_id: int, device_index: int, usb_id: str = '') -> bool:
        """Start a previously disabled camera and add it to the pipeline."""
        with self._lock:
            if any(c.camera_id == camera_id for c in self._cameras):
                return True  # already running
        w, h, fps = self._camera_quality()
        cap = CameraCapture(camera_id=camera_id, device_index=device_index, usb_id=usb_id,
                            width=w, height=h, fps=fps)
        cap.start()
        time.sleep(0.5)
        if not cap.is_alive():
            cap.stop()
            return False
        with self._lock:
            self._cameras.append(cap)
            self._detectors[camera_id] = MotionDetector(threshold=self._motion_threshold, scale=self._motion_scale)
            self._overlay_enabled[camera_id] = True
            if self._running:
                t = threading.Thread(target=self._run_camera, args=(cap,), daemon=True)
                t.start()
                self._threads.append(t)
        return True

    def reload_camera(self, camera_id: int) -> bool:
        """Stop, remove, re-probe, and re-add a camera keeping the same ID."""
        with self._lock:
            cam = next((c for c in self._cameras if c.camera_id == camera_id), None)
            if cam is None:
                return False
            device_idx = cam.device_index
            overlay = self._overlay_enabled.get(camera_id, True)
            hw_adj = dict(cam._hw_adjustments)
            sw_br = cam._sw_brightness
            sw_ct = cam._sw_contrast
            cam.stop()
            self._cameras.remove(cam)
            self._detectors.pop(camera_id, None)
            self._latest_detections.pop(camera_id, None)
            self._overlay_enabled.pop(camera_id, None)
            self._active_events.pop(camera_id, None)
        self._last_motion_time.pop(camera_id, None)
        self._motion_start.pop(camera_id, None)
        self._motion_bboxes.pop(camera_id, None)
        self._auto_resets.pop(camera_id, None)
        self._yolo_timeouts.pop(camera_id, None)
        self._debug_stats.pop(camera_id, None)
        self._cleanup_camera_clips(camera_id)

        time.sleep(1.0)  # Give OS time to release the device

        w, h, fps = self._camera_quality()
        new_cap = CameraCapture(camera_id=camera_id, device_index=device_idx, width=w, height=h, fps=fps,
                                hw_adjustments=hw_adj, sw_brightness=sw_br, sw_contrast=sw_ct)
        new_cap.start()
        time.sleep(0.5)

        with self._lock:
            self._cameras.append(new_cap)
            self._detectors[camera_id] = MotionDetector(threshold=self._motion_threshold, scale=self._motion_scale)
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
                self._cleanup_camera_clips(c.camera_id)

            # Add newly found cameras
            for cap in new_captures:
                self._cameras.append(cap)
                self._detectors[cap.camera_id] = MotionDetector(threshold=self._motion_threshold, scale=self._motion_scale)
                self._overlay_enabled[cap.camera_id] = True
                if self._running:
                    t = threading.Thread(target=self._run_camera, args=(cap,), daemon=True)
                    t.start()
                    self._threads.append(t)

    def get_latest(self, camera_id: int):
        return self._latest_detections.get(camera_id)

    def get_motion_bbox(self, camera_id: int):
        if not self._ai_enabled:
            return None
        return self._motion_bboxes.get(camera_id)

    def get_debug(self, camera_id: int) -> dict:
        return dict(self._debug_stats.get(camera_id, {}))

    def _debug_snapshot(self, cam_id, state, has_motion, motion_secs,
                         cooldown_remaining, last_yolo_ms, last_yolo_time, now):
        return {
            'state': state,
            'model_key': self._detection_model_key,
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
        last_frame_ts = 0.0

        while self._running:
            frame_obj = cam.get_frame()
            if frame_obj is None:
                time.sleep(0.05)
                continue
            if frame_obj.timestamp == last_frame_ts:
                time.sleep(0.02)
                continue
            last_frame_ts = frame_obj.timestamp
            frame = frame_obj.data
            has_motion, motion_mask = motion_detector.detect(frame)
            now = time.time()

            # --- CLIP RING BUFFER & LIVE EXTENSION ---
            if self._clips_enabled:
                last_push = self._last_clip_push.get(cam.camera_id, 0)
                if now - last_push >= CLIP_PUSH_INTERVAL:
                    if cam.camera_id not in self._clip_buffers:
                        self._clip_buffers[cam.camera_id] = ClipBuffer(self._clip_pre_roll)
                    self._clip_buffers[cam.camera_id].push(frame)
                    self._last_clip_push[cam.camera_id] = now
                    with self._clip_lock:
                        cam_writers = dict(self._clip_writers.get(cam.camera_id, {}))
                    for w in cam_writers.values():
                        w.write_frame(frame)
            # ---

            if has_motion:
                if cam.camera_id not in self._motion_start:
                    self._motion_start[cam.camera_id] = now
                self._last_motion_time[cam.camera_id] = now
                motion_secs = now - self._motion_start[cam.camera_id]

                # Update motion bounding box so the stream can draw it before YOLO runs.
                # Only maintained when AI is enabled — no overlay needed without detection.
                if self._ai_enabled:
                    h_f, w_f = frame.shape[:2]
                    ys_m, xs_m = np.where(motion_mask > 0)
                    if len(xs_m):
                        pad_m = 20
                        self._motion_bboxes[cam.camera_id] = (
                            max(0, int(xs_m.min()) - pad_m),
                            max(0, int(ys_m.min()) - pad_m),
                            min(w_f, int(xs_m.max()) + pad_m),
                            min(h_f, int(ys_m.max()) + pad_m),
                        )

                # Auto-reset if motion has been continuous for too long — background model is stuck
                if motion_secs > STUCK_MOTION_SECS:
                    self._auto_resets[cam.camera_id] = self._auto_resets.get(cam.camera_id, 0) + 1
                    with self._lock:
                        self._detectors[cam.camera_id] = MotionDetector(threshold=self._motion_threshold, scale=self._motion_scale)
                        self._latest_detections.pop(cam.camera_id, None)
                        self._active_events.pop(cam.camera_id, None)
                    motion_detector = self._detectors[cam.camera_id]
                    self._motion_start.pop(cam.camera_id, None)
                    self._last_motion_time.pop(cam.camera_id, None)
                    self._motion_bboxes.pop(cam.camera_id, None)
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

                if now > cooldown and self._ai_enabled:
                    t0 = time.time()
                    with self._lock:
                        detector = self._object_detector
                        face_rec = self._face_recognizer

                    faces_enabled = ('faces' in self._enabled_categories and
                                     self._face_cam_enabled.get(cam.camera_id, True))
                    cam_face_sensitivity = self._face_cam_sensitivity.get(cam.camera_id, 'normal')
                    # When all non-face categories are disabled, skip YOLO entirely.
                    # Face detection runs alone, faster, at higher resolution.
                    yolo_categories = self._enabled_categories - {'faces'}
                    faces_only = ('faces' in self._enabled_categories) and not yolo_categories

                    # Face cooldown: 3s when running alone (no YOLO competing), 10s otherwise.
                    FACE_COOLDOWN_SECS = 3.0 if faces_only else 10.0
                    face_result: list = []
                    face_done = threading.Event()
                    face_due = now - self._face_last_run.get(cam.camera_id, 0) >= FACE_COOLDOWN_SECS
                    if faces_enabled and face_due:
                        self._face_last_run[cam.camera_id] = now
                        # In faces-only mode run synchronously (no YOLO to overlap with).
                        # Pass a higher max-dim so small/distant faces have more pixels.
                        if faces_only:
                            try:
                                face_result.extend(face_rec.detect_and_recognize(
                                    frame, max_dim=640, sensitivity=cam_face_sensitivity))
                            except Exception:
                                pass
                            # If full-frame scan missed (common with glasses/IR), do a second
                            # pass cropping the motion region — same upscale trick as the YOLO
                            # person-crop path but using motion bbox as the person proxy.
                            if not face_result:
                                motion_bbox = self._motion_bboxes.get(cam.camera_id)
                                if (motion_bbox and
                                        now - self._face_crop_last_run.get(cam.camera_id, 0) >= 8.0):
                                    self._face_crop_last_run[cam.camera_id] = now
                                    try:
                                        face_result.extend(face_rec.detect_in_crops(frame, [motion_bbox]))
                                    except Exception:
                                        pass
                            face_done.set()
                        else:
                            def _face_work(fr=face_rec, f=frame, sens=cam_face_sensitivity):
                                try:
                                    face_result.extend(fr.detect_and_recognize(f, max_dim=480, sensitivity=sens))
                                except Exception:
                                    pass
                                face_done.set()
                            threading.Thread(target=_face_work, daemon=True).start()
                    else:
                        face_done.set()

                    if faces_only:
                        all_detections, timed_out = [], False
                    else:
                        all_detections, timed_out = _detect_with_timeout(detector, frame)
                        # Collect face results (should finish long before YOLO)
                        if faces_enabled:
                            face_done.wait(timeout=3.0)

                    # Targeted fallback: if face pass found nothing but YOLO found people,
                    # crop each person's head region, upscale it, and re-run detection.
                    # More reliable than full-frame HOG for glasses/IR — the upscaling
                    # gives the detector much more pixels to work with.
                    # Skipped in faces-only mode (no YOLO people available).
                    FACE_CROP_COOLDOWN = 8.0
                    if (not faces_only and faces_enabled and not face_result and
                            now - self._face_crop_last_run.get(cam.camera_id, 0) >= FACE_CROP_COOLDOWN):
                        people = [d for d in all_detections if d.category == 'people']
                        if people:
                            self._face_crop_last_run[cam.camera_id] = now
                            crop_result = []
                            crop_done = threading.Event()
                            def _crop_work(fr=face_rec, f=frame.copy(),
                                           bboxes=[d.bbox for d in people], out=crop_result, ev=crop_done):
                                try:
                                    out.extend(fr.detect_in_crops(f, bboxes))
                                except Exception:
                                    pass
                                ev.set()
                            threading.Thread(target=_crop_work, daemon=True).start()
                            crop_done.wait(timeout=3.0)
                            face_result.extend(crop_result)

                    all_detections = all_detections + face_result

                    # Filter out disabled categories
                    all_detections = [d for d in all_detections if d.category in self._enabled_categories]
                    elapsed = time.time() - t0
                    if timed_out:
                        self._yolo_timeouts[cam.camera_id] = self._yolo_timeouts.get(cam.camera_id, 0) + 1
                        cooldown = now + 5.0
                        self._debug_stats[cam.camera_id] = self._debug_snapshot(
                            cam.camera_id, 'timeout', True, motion_secs, 5.0,
                            last_yolo_ms, last_yolo_time, now)
                        time.sleep(0.05)
                        continue
                    last_yolo_ms = round(elapsed * 1000)
                    last_yolo_time = now

                    # Faces are exempt from the motion filter — you want to know who is
                    # present regardless of whether the face region itself is moving.
                    detections = [d for d in all_detections
                                  if d.category == 'faces' or _bbox_has_motion(motion_mask, d.bbox)]
                    self._handle_detections(cam, frame, detections, now)
                    if not detections:
                        # Motion present but YOLO found nothing in the motion area — clear overlay
                        self._latest_detections.pop(cam.camera_id, None)
                    active = self._active_events.get(cam.camera_id, [])
                    active[:] = [ev for ev in active if now - ev['last_seen'] <= EVENT_GAP]
                    cooldown = now + self._detection_cooldown
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
                    self._motion_bboxes.pop(cam.camera_id, None)
                # Periodic scan for stationary subjects (e.g. a still cat in frame)
                if (self._ai_enabled and
                        now - self._last_periodic_scan.get(cam.camera_id, 0) >= PERIODIC_SCAN_SECS):
                    self._last_periodic_scan[cam.camera_id] = now
                    yolo_categories = self._enabled_categories - {'faces'}
                    if yolo_categories:
                        with self._lock:
                            detector = self._object_detector
                        all_detections, timed_out = _detect_with_timeout(detector, frame)
                        if not timed_out:
                            filtered = [d for d in all_detections
                                        if d.category in self._enabled_categories
                                        and d.category != 'faces']
                            self._handle_detections(cam, frame, filtered, now)
                            active = self._active_events.get(cam.camera_id, [])
                            if active:
                                active[:] = [ev for ev in active if now - ev['last_seen'] <= EVENT_GAP]
                            last_yolo_time = now
                self._debug_stats[cam.camera_id] = self._debug_snapshot(
                    cam.camera_id, 'idle', False, 0, 0, last_yolo_ms, last_yolo_time, now)

            time.sleep(0.05)

    def _handle_detections(self, cam, frame, detections, now):
        """Persist detections: update overlay, create/update events, schedule screenshots."""
        if not detections:
            return
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
                # Create clip writer asynchronously to avoid blocking the camera loop
                if self._clips_enabled:
                    clips_dir = get_active_clips_dir()
                    if clips_dir:
                        buf = self._clip_buffers.get(cam.camera_id)
                        pre_roll = buf.snapshot() if buf else []
                        clip_path = str(
                            Path(clips_dir) / f'cam{cam.camera_id}_{ev["event_id"]}.mp4'
                        )
                        _eid = ev['event_id']
                        _cid = cam.camera_id
                        def _mk_writer(eid=_eid, cp=clip_path, pr=pre_roll, cid=_cid):
                            try:
                                w = EventClipWriter(cp, pr, camera_id=cid)
                                with self._clip_lock:
                                    if cid not in self._clip_writers:
                                        self._clip_writers[cid] = {}
                                    self._clip_writers[cid][eid] = w
                            except Exception:
                                pass
                        threading.Thread(target=_mk_writer, daemon=True).start()
            else:
                ev['bbox'] = d.bbox
                ev['last_seen'] = now
                if self._clips_enabled:
                    with self._clip_lock:
                        w = self._clip_writers.get(cam.camera_id, {}).get(ev['event_id'])
                    if w:
                        w.touch()
            if now - ev['last_screenshot'] >= SCREENSHOT_INTERVAL:
                screenshot_needed.append((d, ev))
        if screenshot_needed:
            annotated = self._annotate(frame.copy(), detections)
            ts = datetime.now(timezone.utc).isoformat()
            notify_dets = []
            first_new_event_id = None
            records = []
            for d, ev in screenshot_needed:
                ev['last_screenshot'] = now
                is_new = not ev['notified']
                ev['notified'] = True
                records.append((d, ev['event_id']))
                if is_new:
                    notify_dets.append(d)
                    if first_new_event_id is None:
                        first_new_event_id = ev['event_id']
            _cam_id = cam.camera_id
            _notify = list(notify_dets)
            _feid = first_new_event_id
            _records = list(records)
            def _persist(ann=annotated, timestamp=ts,
                         cam_id=_cam_id, dets=detections,
                         recs=_records, nd=_notify, feid=_feid):
                try:
                    ip = self._save_image(ann, cam_id, timestamp, dets)
                except Exception:
                    ip = None
                try:
                    for d, event_id in recs:
                        self._store_detection_record(cam_id, d, ip, timestamp, event_id)
                    if nd:
                        asyncio.run(dispatch_notification(cam_id, nd, ip, timestamp, feid))
                except Exception:
                    pass
            threading.Thread(target=_persist, daemon=True).start()

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
        cam_row = db.execute("SELECT name FROM cameras WHERE camera_id=?", (camera_id,)).fetchone()
        db.close()
        tz_name = tz_row[0] if tz_row else 'UTC'
        cam_name = (cam_row[0] if cam_row and cam_row[0] else f"Camera {camera_id}")
        try:
            tz = ZoneInfo(tz_name) if tz_name != 'UTC' else timezone.utc
        except ZoneInfoNotFoundError:
            tz = timezone.utc

        dt = datetime.fromisoformat(ts).astimezone(tz)
        hour = dt.strftime('%I').lstrip('0') or '12'
        time_str = dt.strftime(f'%a %b {dt.day}, %Y  {hour}:%M %p %Z')

        if detections:
            parts = [f"{d.label}  {round(d.confidence * 100)}%" for d in detections]
            det_str = '   |   '.join(parts)
        else:
            det_str = ''

        h, w = frame.shape[:2]
        bar_h = 36
        cv2.rectangle(frame, (0, h - bar_h), (w, h), (40, 40, 40), -1)

        font = cv2.FONT_HERSHEY_SIMPLEX
        scale, thick = 0.48, 1
        fg = (210, 210, 210)
        text_y = h - bar_h + 24

        left_str = f"{cam_name}  -  {time_str}"
        cv2.putText(frame, left_str, (8, text_y), font, scale, fg, thick, cv2.LINE_AA)

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
