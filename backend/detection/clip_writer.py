import cv2
import numpy as np
import time
import threading
import logging
from collections import deque
from pathlib import Path

_log = logging.getLogger(__name__)

CLIP_FPS = 5.0
CLIP_PUSH_INTERVAL = 1.0 / CLIP_FPS
CLIP_WIDTH = 640
CLIP_HEIGHT = 360
CLIP_MAX_DURATION = 120.0  # hard cap: 2 minutes per clip regardless of ongoing motion


class ClipBuffer:
    """Per-camera JPEG ring buffer for clip pre-roll. Thread-safe."""

    def __init__(self, pre_roll_secs: float):
        max_frames = int(pre_roll_secs * CLIP_FPS) + 10
        self._buf: deque = deque(maxlen=max_frames)
        self._lock = threading.Lock()

    def push(self, frame_bgr):
        try:
            if frame_bgr.shape[:2] != (CLIP_HEIGHT, CLIP_WIDTH):
                frame_bgr = cv2.resize(frame_bgr, (CLIP_WIDTH, CLIP_HEIGHT))
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

    def __init__(self, output_path: str, pre_roll: list, camera_id: int = 0):
        self._path = output_path
        self._camera_id = camera_id
        self._lock = threading.Lock()
        self._closed = False
        self._start = time.time()
        self._last_extend = time.time()

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # GStreamer openh264enc: software H.264, avoids h264_v4l2m2m conflict with active cameras
        gst = (f'appsrc ! videoconvert ! openh264enc ! h264parse ! mp4mux '
               f'! filesink location={output_path}')
        self._writer = cv2.VideoWriter(gst, cv2.CAP_GSTREAMER, 0, CLIP_FPS, (CLIP_WIDTH, CLIP_HEIGHT), True)
        if self._writer.isOpened():
            _log.info('clip_writer: using GStreamer openh264enc for %s', output_path)
        else:
            self._writer.release()
            # Fallback: FFmpeg avc1
            fourcc = cv2.VideoWriter_fourcc(*'avc1')
            self._writer = cv2.VideoWriter(output_path, fourcc, CLIP_FPS, (CLIP_WIDTH, CLIP_HEIGHT))
            if self._writer.isOpened():
                _log.info('clip_writer: using FFmpeg avc1 for %s', output_path)
            else:
                self._writer.release()
                # Last resort: mp4v
                _log.warning('clip_writer: H.264 failed, falling back to mp4v for %s', output_path)
                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                self._writer = cv2.VideoWriter(output_path, fourcc, CLIP_FPS, (CLIP_WIDTH, CLIP_HEIGHT))

        for jpeg_bytes in pre_roll:
            self._write_jpeg(jpeg_bytes)

    def _write_jpeg(self, jpeg_bytes: bytes):
        try:
            arr = np.frombuffer(jpeg_bytes, dtype='uint8')
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is not None:
                if frame.shape[:2] != (CLIP_HEIGHT, CLIP_WIDTH):
                    frame = cv2.resize(frame, (CLIP_WIDTH, CLIP_HEIGHT))
                self._writer.write(frame)
        except Exception:
            pass

    def extend(self, frame_bgr):
        """Add a live frame and reset the post-roll timer."""
        with self._lock:
            if self._closed:
                return
            self._last_extend = time.time()
            try:
                f = frame_bgr
                if f.shape[:2] != (CLIP_HEIGHT, CLIP_WIDTH):
                    f = cv2.resize(f, (CLIP_WIDTH, CLIP_HEIGHT))
                self._writer.write(f)
            except Exception:
                pass

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
