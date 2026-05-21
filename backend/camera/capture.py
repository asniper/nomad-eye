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
    def __init__(self, camera_id: int, device_index: int):
        self.camera_id = camera_id
        self.device_index = device_index
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
            return self._frame

    def is_alive(self) -> bool:
        return self._running and (self._cap is not None and self._cap.isOpened())

    def _capture_loop(self):
        while self._running:
            if self._cap and self._cap.isOpened():
                ret, frame = self._cap.read()
                if ret:
                    with self._lock:
                        self._frame = Frame(
                            camera_id=self.camera_id,
                            data=frame,
                            timestamp=time.time()
                        )
            time.sleep(0.033)
