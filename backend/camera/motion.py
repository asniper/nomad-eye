import cv2
import numpy as np
from config.settings import get_settings

cfg = get_settings()

class MotionDetector:
    def __init__(self):
        self._bg_subtractor = cv2.createBackgroundSubtractorMOG2(
            history=500, varThreshold=16, detectShadows=False
        )

    def detect(self, frame: np.ndarray) -> tuple[bool, np.ndarray]:
        fg_mask = self._bg_subtractor.apply(frame)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel)
        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        motion_area = sum(cv2.contourArea(c) for c in contours)
        return motion_area > cfg.motion_threshold, fg_mask
