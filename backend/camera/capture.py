import cv2
import threading
import time
from dataclasses import dataclass
from typing import Optional

@dataclass
class Frame:
    camera_id: int
    data: any
    timestamp: float

class CameraCapture:
    def __init__(self, camera_id: int, device_index: int, usb_id: str = ''):
        self.camera_id = camera_id
        self.device_index = device_index
        self.device_path = f"/dev/video{device_index}"
        self.usb_id = usb_id
        self._cap: Optional[cv2.VideoCapture] = None
        self._frame: Optional[Frame] = None
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        self._cap = cv2.VideoCapture(self.device_index)
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        self._running = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._cap:
            self._cap.release()

    def get_frame(self) -> Optional[Frame]:
        with self._lock:
            if self._frame is None:
                return None
            if time.time() - self._frame.timestamp > 2.0:
                return None  # stale — camera disconnected or frozen
            return self._frame

    def is_alive(self) -> bool:
        return self._running and (self._cap is not None and self._cap.isOpened())

    def _capture_loop(self):
        consecutive_failures = 0
        while self._running:
            if self._cap and self._cap.isOpened():
                ret, frame = self._cap.read()
                if ret:
                    consecutive_failures = 0
                    with self._lock:
                        self._frame = Frame(
                            camera_id=self.camera_id,
                            data=frame,
                            timestamp=time.time()
                        )
                else:
                    consecutive_failures += 1
                    if consecutive_failures >= 10:
                        self._running = False
                        break
            else:
                consecutive_failures += 1
                if consecutive_failures >= 10:
                    self._running = False
                    break
            time.sleep(0.033)
