import cv2
import numpy as np
import threading
import time
from dataclasses import dataclass
from typing import Optional

# Software night enhancement: CLAHE on luminance + gamma lift.
# Used when hardware IR control is unavailable (photocell-only cameras).
# CLAHE dramatically improves local contrast on IR images; gamma lifts shadows.
_NIGHT_CLAHE = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
_NIGHT_GAMMA_LUT = np.array([int(((i / 255.0) ** 0.6) * 255) for i in range(256)], dtype=np.uint8)


def _apply_night_sw(frame: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = _NIGHT_CLAHE.apply(l)
    l = cv2.LUT(l, _NIGHT_GAMMA_LUT)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)

@dataclass
class Frame:
    camera_id: int
    data: any
    timestamp: float

class CameraCapture:
    def __init__(self, camera_id: int, device_index: int, usb_id: str = '',
                 width: int = 1280, height: int = 720, fps: int = 15,
                 hw_adjustments: dict = None, sw_brightness: int = 0, sw_contrast: float = 1.0,
                 night_mode: str = 'off'):
        self.camera_id = camera_id
        self.device_index = device_index
        self.device_path = f"/dev/video{device_index}"
        self.usb_id = usb_id
        self._width = width
        self._height = height
        self._fps = fps
        self._hw_adjustments: dict = hw_adjustments or {}
        self._sw_brightness: int = sw_brightness
        self._sw_contrast: float = sw_contrast
        self._night_mode: str = night_mode
        self._night_mode_hw: bool = False  # True if XU ioctl succeeded
        self._cap: Optional[cv2.VideoCapture] = None
        self._frame: Optional[Frame] = None
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._actual_fps: int = 0
        self._fps_count: int = 0
        self._fps_window: float = 0.0

    def start(self):
        self._cap = cv2.VideoCapture(self.device_index)
        # Request MJPEG from the camera so USB carries compressed data (~5-15 Mbps)
        # instead of raw YUYV (~440 Mbps at 720p). Critical when multiple cameras
        # share the same USB 2.0 hub/bus — uncompressed overflows 480 Mbps bandwidth.
        self._cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M', 'J', 'P', 'G'))
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
        self._cap.set(cv2.CAP_PROP_FPS, self._fps)
        if self._hw_adjustments:
            from camera.v4l2 import apply_controls
            apply_controls(self.device_path, self._hw_adjustments)
        from camera.arducam_xu import set_night_mode as _xu_night
        self._night_mode_hw = _xu_night(self.device_path, self._night_mode)
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

    @property
    def resolution(self) -> tuple[int, int, int]:
        """Returns (width, height, fps) — actual dimensions from the open device, actual consumed fps from the loop."""
        if self._cap and self._cap.isOpened():
            w = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            if w > 0 and h > 0:
                return w, h, self._actual_fps
        return self._width, self._height, self._actual_fps

    def set_fps(self, fps: int):
        self._fps = max(1, fps)

    def set_night_mode(self, mode: str):
        self._night_mode = mode
        from camera.arducam_xu import set_night_mode as _xu_night
        self._night_mode_hw = _xu_night(self.device_path, mode)

    def set_adjustments(self, hw: dict = None, sw_brightness: int = None, sw_contrast: float = None):
        if hw is not None:
            self._hw_adjustments = hw
            if self._cap and self._cap.isOpened():
                from camera.v4l2 import apply_controls
                apply_controls(self.device_path, hw)
        if sw_brightness is not None:
            self._sw_brightness = sw_brightness
        if sw_contrast is not None:
            self._sw_contrast = sw_contrast

    def _reopen_without_mjpeg(self):
        """Reopen capture without forcing MJPEG — fallback for cameras that don't support it."""
        if self._cap:
            self._cap.release()
        self._cap = cv2.VideoCapture(self.device_index)
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
        self._cap.set(cv2.CAP_PROP_FPS, self._fps)
        if self._hw_adjustments:
            from camera.v4l2 import apply_controls
            apply_controls(self.device_path, self._hw_adjustments)
        if self._night_mode_hw:
            from camera.arducam_xu import set_night_mode as _xu_night
            _xu_night(self.device_path, self._night_mode)

    def _capture_loop(self):
        consecutive_failures = 0
        _mjpeg_fallback_done = False
        _next_capture = time.time()

        while self._running:
            now = time.time()
            wait = _next_capture - now
            if wait > 0:
                time.sleep(wait)
                continue

            if self._cap and self._cap.isOpened():
                try:
                    ret, frame = self._cap.read()
                except Exception:
                    ret, frame = False, None
                if ret:
                    if self._sw_brightness != 0 or self._sw_contrast != 1.0:
                        frame = cv2.convertScaleAbs(frame, alpha=self._sw_contrast, beta=self._sw_brightness)
                    if not self._night_mode_hw:
                        if self._night_mode == 'on':
                            frame = _apply_night_sw(frame)
                        elif self._night_mode == 'auto':
                            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                            if cv2.resize(gray, (1, 1))[0][0] < 80:
                                frame = _apply_night_sw(frame)
                    consecutive_failures = 0
                    now = time.time()
                    _next_capture = now + 1.0 / max(self._fps, 1)
                    if self._fps_window == 0.0:
                        self._fps_window = now
                    self._fps_count += 1
                    if now - self._fps_window >= 1.0:
                        self._actual_fps = round(self._fps_count / (now - self._fps_window))
                        self._fps_count = 0
                        self._fps_window = now
                    with self._lock:
                        self._frame = Frame(
                            camera_id=self.camera_id,
                            data=frame,
                            timestamp=now,
                        )
                else:
                    consecutive_failures += 1
                    _next_capture = time.time() + 1.0 / max(self._fps, 1)
                    if not _mjpeg_fallback_done and consecutive_failures >= 5:
                        # MJPEG may not be supported — retry with default format
                        self._reopen_without_mjpeg()
                        consecutive_failures = 0
                        _mjpeg_fallback_done = True
                    elif consecutive_failures >= 10:
                        self._running = False
                        break
            else:
                consecutive_failures += 1
                _next_capture = time.time() + 1.0 / max(self._fps, 1)
                if consecutive_failures >= 10:
                    self._running = False
                    break
