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
        fg_mask = self._bg_subtractor.apply(frame)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel)
        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        motion_area = sum(cv2.contourArea(c) for c in contours)
        # If more than max_coverage of the frame is flagged it's a global illumination
        # change (LED flicker, scan lines, power cycle) rather than real subject motion.
        frame_area = frame.shape[0] * frame.shape[1]
        if frame_area > 0 and motion_area / frame_area > self._max_coverage:
            return False, fg_mask
        return motion_area > self._threshold, fg_mask
