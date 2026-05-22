import os
import numpy as np
from dataclasses import dataclass
from typing import List
import torch
torch.set_num_threads(1)   # prevent PyTorch from spawning N-core worker threads
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

# faces category is handled by FaceRecognizer, not YOLO

# BGR color per category for OpenCV overlays
# Matches the hex colors used on the frontend:
#   people=#EF4444, vehicles=#3B82F6, animals=#22C55E, other=#F59E0B, faces=#A855F7
CATEGORY_COLORS_BGR = {
    "people":   (68,  68,  239),
    "vehicles": (246, 130, 59),
    "animals":  (94,  197, 34),
    "other":    (11,  158, 245),
    "faces":    (247, 85,  168),
}

@dataclass
class Detection:
    label: str
    category: str
    confidence: float
    bbox: tuple

_CATEGORIES_LIST = ["people", "vehicles", "animals", "other", "faces"]

def _resolve_model(model_name: str) -> str:
    """Prefer yolov8n.onnx over yolov8n.pt when available — faster CPU inference."""
    if model_name.endswith('.pt'):
        onnx = model_name[:-3] + '.onnx'
        here = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), onnx)
        if os.path.exists(here):
            return here
    return model_name

class ObjectDetector:
    def __init__(self, model_name: str = "yolov8n.pt", confidences: dict = None):
        self._model = YOLO(_resolve_model(model_name))
        default = cfg.detection_confidence
        self._confidences = {c: confidences.get(c, default) if confidences else default
                             for c in _CATEGORIES_LIST}

    def reload(self, model_name: str):
        self._model = YOLO(_resolve_model(model_name))

    def set_category_confidence(self, category: str, value: float):
        if category in self._confidences:
            self._confidences[category] = value

    def detect(self, frame: np.ndarray) -> List[Detection]:
        min_conf = min(self._confidences.values())
        results = self._model(frame, verbose=False, conf=min_conf, imgsz=224)[0]
        detections = []
        for box in results.boxes:
            label = results.names[int(box.cls)]
            confidence = float(box.conf)
            category = CATEGORIES.get(label, "other")
            if confidence < self._confidences.get(category, min_conf):
                continue
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            detections.append(Detection(label=label, category=category, confidence=confidence, bbox=(x1, y1, x2, y2)))
        return detections
