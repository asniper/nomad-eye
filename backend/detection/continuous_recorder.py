import cv2
import time
import threading
from pathlib import Path
from detection.clip_writer import CLIP_WIDTH, CLIP_HEIGHT, CLIP_FPS

# Ambient footage for reviewing the gaps between events, not forensic-quality video —
# same resolution/frame rate as event clips, on purpose, so storage math stays predictable.
SEGMENT_DURATION_SECS = 300  # 5 minutes per segment


class SegmentWriter:
    """Writes one fixed-duration continuous-recording segment."""

    def __init__(self, output_path: str, camera_id: int = 0):
        self._path = output_path
        self.camera_id = camera_id
        self.started_at = time.time()
        self._closed = False
        self._lock = threading.Lock()
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        # mp4v, same as EventClipWriter — converted to H.264 after close for browser playback.
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        self._writer = cv2.VideoWriter(output_path, fourcc, CLIP_FPS, (CLIP_WIDTH, CLIP_HEIGHT))

    def write_frame(self, frame_bgr):
        # A disable (set_continuous_enabled(False)) can call close() from a different
        # thread than the camera loop calling write_frame() — without this lock, write()
        # could run concurrently with release() on the same cv2.VideoWriter.
        with self._lock:
            if self._closed:
                return
            try:
                f = frame_bgr
                if f.shape[:2] != (CLIP_HEIGHT, CLIP_WIDTH):
                    f = cv2.resize(f, (CLIP_WIDTH, CLIP_HEIGHT))
                self._writer.write(f)
            except Exception:
                pass

    def should_rotate(self) -> bool:
        return not self._closed and (time.time() - self.started_at) >= SEGMENT_DURATION_SECS

    def close(self) -> str | None:
        """Release the writer. Returns the file path if the segment is valid, else None."""
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
