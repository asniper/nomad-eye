import cv2
import numpy as np
from config.settings import get_settings

cfg = get_settings()

class MotionDetector:
    def __init__(self, threshold: int = None, max_coverage: float = 0.60):
        self._bg_subtractor = cv2.createBackgroundSubtractorMOG2(
            history=500, varThreshold=16, detectShadows=False
        )
        self._threshold = threshold if threshold is not None else cfg.motion_threshold
        self._max_coverage = max_coverage

    def detect(self, frame: np.ndarray) -> tuple[bool, np.ndarray]:
        h, w = frame.shape[:2]
        small = cv2.resize(frame, (w // 2, h // 2), interpolation=cv2.INTER_NEAREST)
        fg_small = self._bg_subtractor.apply(small)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        fg_small = cv2.morphologyEx(fg_small, cv2.MORPH_OPEN, kernel)
        fg_mask = cv2.resize(fg_small, (w, h), interpolation=cv2.INTER_NEAREST)
        contours, _ = cv2.findContours(fg_small, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        motion_area = sum(cv2.contourArea(c) for c in contours) * 4
        frame_area = h * w
        if frame_area > 0 and motion_area / frame_area > self._max_coverage:
            return False, fg_mask
        return motion_area > self._threshold, fg_mask
