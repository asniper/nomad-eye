import cv2
import numpy as np
from dataclasses import dataclass
from typing import List
from config.settings import get_settings

cfg = get_settings()

CATEGORIES = {
    "person": "people",
    "bicycle": "vehicles",
    "car": "vehicles",
    "motorcycle": "vehicles",
    "bus": "vehicles",
    "truck": "vehicles",
    "dog": "animals",
    "cat": "animals",
    "bird": "animals",
    "horse": "animals",
    "sheep": "animals",
    "cow": "animals",
    "bear": "animals",
    "deer": "animals",
    "rabbit": "animals",
}

COCO_LABELS = [
    "person","bicycle","car","motorcycle","airplane","bus","train","truck","boat",
    "traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat",
    "dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack",
    "umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball",
    "kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket",
    "bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple",
    "sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair",
    "couch","potted plant","bed","dining table","toilet","tv","laptop","mouse",
    "remote","keyboard","cell phone","microwave","oven","toaster","sink","refrigerator",
    "book","clock","vase","scissors","teddy bear","hair drier","toothbrush"
]

@dataclass
class Detection:
    label: str
    category: str
    confidence: float
    bbox: tuple

class ObjectDetector:
    def __init__(self):
        self._net = cv2.dnn.readNetFromONNX(cfg.model_path)

    def detect(self, frame: np.ndarray) -> List[Detection]:
        blob = cv2.dnn.blobFromImage(frame, 1/255.0, (640, 640), swapRB=True)
        self._net.setInput(blob)
        outputs = self._net.forward()
        return self._parse_outputs(outputs, frame.shape, cfg.detection_confidence)

    def _parse_outputs(self, outputs, shape, conf_threshold) -> List[Detection]:
        h, w = shape[:2]
        detections = []
        for det in outputs[0]:
            scores = det[4:]
            class_id = int(np.argmax(scores))
            confidence = float(scores[class_id])
            if confidence < conf_threshold:
                continue
            cx, cy, bw, bh = det[:4]
            x1 = int((cx - bw / 2) * w / 640)
            y1 = int((cy - bh / 2) * h / 640)
            x2 = int((cx + bw / 2) * w / 640)
            y2 = int((cy + bh / 2) * h / 640)
            label = COCO_LABELS[class_id] if class_id < len(COCO_LABELS) else "unknown"
            category = CATEGORIES.get(label, "other")
            detections.append(Detection(label=label, category=category, confidence=confidence, bbox=(x1, y1, x2, y2)))
        return detections
