import cv2
import numpy as np
from config.settings import get_settings

cfg = get_settings()

class MotionDetector:
    def __init__(self, threshold: int = None, max_coverage: float = 0.60, scale: float = 0.5):
        self._bg_subtractor = cv2.createBackgroundSubtractorMOG2(
            history=500, varThreshold=16, detectShadows=False
        )
        self._threshold = threshold if threshold is not None else cfg.motion_threshold
        self._max_coverage = max_coverage
        self._scale = max(0.25, min(1.0, float(scale)))
        # Kernel depends only on scale, so build it once instead of every frame.
        k = 3 if self._scale < 1.0 else 5
        self._kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))

    def detect(self, frame: np.ndarray) -> tuple[bool, np.ndarray]:
        h, w = frame.shape[:2]
        if self._scale < 1.0:
            sw, sh = max(1, int(w * self._scale)), max(1, int(h * self._scale))
            small = cv2.resize(frame, (sw, sh), interpolation=cv2.INTER_NEAREST)
        else:
            small = frame
        fg_small = self._bg_subtractor.apply(small)
        fg_small = cv2.morphologyEx(fg_small, cv2.MORPH_OPEN, self._kernel)
        contours, _ = cv2.findContours(fg_small, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        motion_area = sum(cv2.contourArea(c) for c in contours) * (1.0 / self._scale) ** 2
        frame_area = h * w
        if frame_area > 0 and motion_area / frame_area > self._max_coverage:
            return False, None
        if motion_area <= self._threshold:
            return False, None
        # The mask is only read by callers on the motion path, so the full-res
        # upscale is deferred to here — the common no-motion frame never pays it.
        fg_mask = cv2.resize(fg_small, (w, h), interpolation=cv2.INTER_NEAREST) if self._scale < 1.0 else fg_small
        return True, fg_mask
