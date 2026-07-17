import cv2
import numpy as np
import time
import threading
from collections import deque
from pathlib import Path

# Defaults — overridable per-instance via DetectionPipeline.set_recording_quality(),
# which sources current values from the recording_width/height/fps app_config keys.
CLIP_FPS = 5.0
CLIP_PUSH_INTERVAL = 1.0 / CLIP_FPS
CLIP_WIDTH = 640
CLIP_HEIGHT = 360
CLIP_MAX_DURATION = 120.0  # hard cap: 2 minutes per clip regardless of ongoing motion


class ClipBuffer:
    """Per-camera JPEG ring buffer for clip pre-roll. Thread-safe."""

    def __init__(self, pre_roll_secs: float, width: int = CLIP_WIDTH, height: int = CLIP_HEIGHT, fps: float = CLIP_FPS):
        self._width = width
        self._height = height
        max_frames = int(pre_roll_secs * fps) + 10
        self._buf: deque = deque(maxlen=max_frames)
        self._lock = threading.Lock()

    def push(self, frame_bgr):
        try:
            if frame_bgr.shape[:2] != (self._height, self._width):
                frame_bgr = cv2.resize(frame_bgr, (self._width, self._height))
            ret, enc = cv2.imencode('.jpg', frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if ret:
                with self._lock:
                    self._buf.append(bytes(enc))
        except Exception:
            pass

    def snapshot(self) -> list:
        with self._lock:
            return list(self._buf)


class EventClipWriter:
    """Writes one MP4 clip for one event: pre-roll JPEG frames + live frames."""

    def __init__(self, output_path: str, pre_roll: list, camera_id: int = 0,
                 width: int = CLIP_WIDTH, height: int = CLIP_HEIGHT, fps: float = CLIP_FPS):
        self._path = output_path
        self._camera_id = camera_id
        self._width = width
        self._height = height
        self._lock = threading.Lock()
        self._closed = False
        self._start = time.time()
        self._last_extend = time.time()

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # Write with mp4v (compatible with pip opencv-python-headless bundled FFmpeg).
        # pipeline.py converts to H.264 via system ffmpeg after recording completes.
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        self._writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

        for jpeg_bytes in pre_roll:
            self._write_jpeg(jpeg_bytes)

    def _write_jpeg(self, jpeg_bytes: bytes):
        try:
            arr = np.frombuffer(jpeg_bytes, dtype='uint8')
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is not None:
                if frame.shape[:2] != (self._height, self._width):
                    frame = cv2.resize(frame, (self._width, self._height))
                self._writer.write(frame)
        except Exception:
            pass

    def write_frame(self, frame_bgr):
        """Write a frame without resetting the post-roll timer."""
        with self._lock:
            if self._closed:
                return
            try:
                f = frame_bgr
                if f.shape[:2] != (self._height, self._width):
                    f = cv2.resize(f, (self._width, self._height))
                self._writer.write(f)
            except Exception:
                pass

    def touch(self):
        """Reset the post-roll timer (called when a detection confirms event is still active)."""
        with self._lock:
            if not self._closed:
                self._last_extend = time.time()

    def extend(self, frame_bgr):
        """Write a frame and reset the post-roll timer."""
        self.write_frame(frame_bgr)
        self.touch()

    def should_close(self, post_roll_secs: float) -> bool:
        if self._closed:
            return False
        now = time.time()
        return (now - self._last_extend > post_roll_secs) or (now - self._start > CLIP_MAX_DURATION)

    def close(self) -> str | None:
        """Release writer. Returns the file path if the clip is valid, else None."""
        with self._lock:
            if self._closed:
                return None
            self._closed = True
            try:
                self._writer.release()
            except Exception:
                pass
            self._writer = None
        p = Path(self._path)
        if p.exists() and p.stat().st_size > 5000:
            return str(p)
        try:
            p.unlink(missing_ok=True)
        except Exception:
            pass
        return None
