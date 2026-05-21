import cv2
import time
import threading
import asyncio
from pathlib import Path
from datetime import datetime
from camera.capture import CameraCapture
from camera.motion import MotionDetector
from detection.detector import ObjectDetector
from notifications.dispatcher import dispatch_notification
from config.settings import get_settings
import sqlite3

cfg = get_settings()

class DetectionPipeline:
    def __init__(self, cameras: list[CameraCapture]):
        self._cameras = list(cameras)
        self._detectors = {cam.camera_id: MotionDetector() for cam in cameras}
        self._object_detector = ObjectDetector()
        self._running = False
        self._threads: list[threading.Thread] = []
        self._latest_detections: dict = {}
        self._overlay_enabled: dict = {cam.camera_id: True for cam in cameras}
        self._lock = threading.Lock()

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

    def _run_camera(self, cam: CameraCapture):
        motion_detector = self._detectors[cam.camera_id]
        cooldown = 0
        while self._running:
            frame_obj = cam.get_frame()
            if frame_obj is None:
                time.sleep(0.05)
                continue
            frame = frame_obj.data
            has_motion, _ = motion_detector.detect(frame)
            if has_motion and time.time() > cooldown:
                detections = self._object_detector.detect(frame)
                if detections:
                    annotated = self._annotate(frame.copy(), detections)
                    ts = datetime.utcnow().isoformat()
                    img_path = self._save_image(annotated, cam.camera_id, ts)
                    self._latest_detections[cam.camera_id] = detections
                    self._store_and_notify(cam.camera_id, detections, img_path, ts)
                    cooldown = time.time() + 3
            time.sleep(0.05)

    def _annotate(self, frame, detections):
        for d in detections:
            x1, y1, x2, y2 = d.bbox
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(frame, f"{d.label} {d.confidence:.0%}", (x1, y1 - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        return frame

    def _save_image(self, frame, camera_id, ts):
        safe_ts = ts.replace(":", "-").replace(".", "-")
        path = Path(cfg.images_dir) / f"cam{camera_id}_{safe_ts}.jpg"
        path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(path), frame)
        return str(path)

    def _store_and_notify(self, camera_id, detections, image_path, ts):
        db = sqlite3.connect(cfg.db_path)
        for d in detections:
            db.execute(
                "INSERT INTO detections (camera_id, category, label, confidence, image_path, timestamp) VALUES (?,?,?,?,?,?)",
                (camera_id, d.category, d.label, d.confidence, image_path, ts)
            )
        db.commit()
        db.close()
        asyncio.run(dispatch_notification(camera_id, detections, image_path, ts))
