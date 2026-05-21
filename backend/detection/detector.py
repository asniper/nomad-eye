import numpy as np
from dataclasses import dataclass
from typing import List
from ultralytics import YOLO
from config.settings import get_settings

cfg = get_settings()

CATEGORIES = {
    "person": "people",
    "bicycle": "vehicles", "car": "vehicles", "motorcycle": "vehicles",
    "bus": "vehicles", "truck": "vehicles",
    "dog": "animals", "cat": "animals", "bird": "animals",
    "horse": "animals", "sheep": "animals", "cow": "animals",
    "bear": "animals", "deer": "animals", "rabbit": "animals",
}

@dataclass
class Detection:
    label: str
    category: str
    confidence: float
    bbox: tuple

class ObjectDetector:
    def __init__(self):
        self._model = YOLO("yolov8n.pt")

    def detect(self, frame: np.ndarray) -> List[Detection]:
        results = self._model(frame, verbose=False, conf=cfg.detection_confidence)[0]
        detections = []
        for box in results.boxes:
            label = results.names[int(box.cls)]
            confidence = float(box.conf)
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            category = CATEGORIES.get(label, "other")
            detections.append(Detection(label=label, category=category, confidence=confidence, bbox=(x1, y1, x2, y2)))
        return detections
