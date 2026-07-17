import os
import cv2
import numpy as np
from dataclasses import dataclass
from typing import List
from config.settings import get_settings

cfg = get_settings()

CATEGORIES = {
    "person": "people",
    "bicycle": "vehicles", "car": "vehicles", "motorcycle": "vehicles",
    "bus": "vehicles", "truck": "vehicles",
    "dog": "animals", "cat": "animals", "bird": "animals",
    "horse": "animals", "sheep": "animals", "cow": "animals",
    "bear": "animals",
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

_CATEGORIES_LIST = ["people", "faces", "vehicles", "animals", "other"]
_CATEGORY_PRIORITY = {c: i for i, c in enumerate(_CATEGORIES_LIST)}

DEFAULT_WILDLIFE_CLASSES = [
    "deer", "moose", "elk", "bear", "mountain lion", "bobcat", "coyote",
    "fox", "raccoon", "skunk", "rabbit", "squirrel", "groundhog",
    "muskrat", "ferret", "cat", "dog", "bird", "person",
    "car", "truck", "bus", "motorcycle", "bicycle", "van", "ATV", "snowmobile",
]

_PEOPLE_TERMS = {'person', 'people', 'human', 'man', 'woman', 'child', 'pedestrian', 'individual'}
_VEHICLE_TERMS = {'car', 'truck', 'bus', 'motorcycle', 'bicycle', 'van', 'vehicle', 'automobile', 'motorbike', 'bike', 'atv', 'snowmobile', 'quad', 'sled'}

MODELS = [
    {
        "key": "yolov8n",
        "name": "YOLOv8 Nano",
        "speed": "Fast",
        "description": "Fastest standard model. Best for limited CPU. Detects people, vehicles, and common animals: cat, dog, bird, bear, horse, cow, sheep. Does not detect deer, moose, or most North American wildlife.",
        "open_vocab": False,
        "requires_install": False,
        "default_classes": None,
    },
    {
        "key": "yolov8s",
        "name": "YOLOv8 Small",
        "speed": "Medium",
        "description": "More accurate than Nano with the same COCO-80 classes. Better at detecting small or distant subjects.",
        "open_vocab": False,
        "requires_install": False,
        "default_classes": None,
    },
    {
        "key": "yolov8m",
        "name": "YOLOv8 Medium",
        "speed": "Slow",
        "description": "Highest accuracy of the standard YOLO line. Same COCO-80 classes. Significantly slower on ARM — best with a fast CPU.",
        "open_vocab": False,
        "requires_install": False,
        "default_classes": None,
    },
    {
        "key": "yolov8s-worldv2",
        "name": "YOLOWorld",
        "speed": "Medium",
        "description": "Open-vocabulary YOLO — you define what to detect. Add deer, moose, elk, mountain lion, bobcat, etc. ~44 MB download on first use. Best balance of speed and North American wildlife detection.",
        "open_vocab": True,
        "requires_install": False,
        "default_classes": DEFAULT_WILDLIFE_CLASSES,
    },
    {
        "key": "megadetector",
        "name": "MegaDetector v5",
        "speed": "Medium",
        "description": "Trained on millions of wildlife camera trap images by Microsoft. Detects any animal (deer, moose, elk, mountain lion, bobcat — anything) as 'animal'. Also detects people and vehicles. ~220 MB download. Best raw wildlife sensitivity; does not identify specific species.",
        "open_vocab": False,
        "requires_install": False,
        "default_classes": None,
    },
    {
        "key": "owlv2",
        "name": "OWLv2",
        "speed": "Very Slow",
        "description": "Google's open-vocabulary vision transformer. Define any class by name — high accuracy on rare or unusual species. Very slow on CPU (10–30s/scan); only practical with periodic scanning enabled. Requires transformers library (~2 GB download).",
        "open_vocab": True,
        "requires_install": True,
        "default_classes": DEFAULT_WILDLIFE_CLASSES,
    },
    {
        "key": "grounding-dino",
        "name": "Grounding DINO",
        "speed": "Very Slow",
        "description": "Powerful open-vocabulary detection — describe objects in natural language. Very slow on CPU. Useful for difficult or rare subjects. Requires transformers library.",
        "open_vocab": True,
        "requires_install": True,
        "default_classes": DEFAULT_WILDLIFE_CLASSES,
    },
]

_MODELS_BY_KEY = {m["key"]: m for m in MODELS}


def _compute_iou(a: tuple, b: tuple) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter == 0:
        return 0.0
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0


def _apply_nms(detections: List['Detection']) -> List['Detection']:
    """Cross-class NMS: drop overlapping boxes that represent the same object.

    Same-category pairs are suppressed at IoU > 0.5 (standard NMS).
    Cross-category pairs are suppressed at IoU > 0.85 — catches cases like a
    person/chair combination firing as both 'person' and 'cat' (misclassification
    where two model classes fire on the same region).
    Higher-confidence box always wins; detections are sorted before comparison.
    """
    if len(detections) <= 1:
        return detections
    dets = sorted(detections, key=lambda d: d.confidence, reverse=True)
    suppressed = [False] * len(dets)
    for i in range(len(dets)):
        if suppressed[i]:
            continue
        for j in range(i + 1, len(dets)):
            if suppressed[j]:
                continue
            iou = _compute_iou(dets[i].bbox, dets[j].bbox)
            same_cat = dets[i].category == dets[j].category
            if (same_cat and iou > 0.5) or (not same_cat and iou > 0.85):
                suppressed[j] = True
    return [d for d, s in zip(dets, suppressed) if not s]


def _classify_open_vocab(label: str) -> str:
    """Map a free-text class label to our category system."""
    l = label.lower().strip()
    if l in CATEGORIES:
        return CATEGORIES[l]
    if l in _PEOPLE_TERMS:
        return 'people'
    if l in _VEHICLE_TERMS:
        return 'vehicles'
    return 'animals'


_DETECT_IMGSZ = 320  # must match the imgsz used in ObjectDetector.detect()

def _resolve_model(model_name: str) -> str:
    """Prefer .onnx over .pt when available, but only if its input shape matches _DETECT_IMGSZ."""
    if model_name.endswith('.pt'):
        onnx = model_name[:-3] + '.onnx'
        here = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), onnx)
        if os.path.exists(here):
            try:
                import onnxruntime as ort
                sess = ort.InferenceSession(here, providers=['CPUExecutionProvider'])
                shape = sess.get_inputs()[0].shape  # [1, 3, H, W]
                if shape[2] == _DETECT_IMGSZ and shape[3] == _DETECT_IMGSZ:
                    return here
            except Exception:
                pass
    return model_name


def _models_dir() -> str:
    d = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'models')
    os.makedirs(d, exist_ok=True)
    return d


class ObjectDetector:
    def __init__(self, model_name: str = "yolov8n.pt", confidences: dict = None):
        # ultralytics pulls in torch (hundreds of MB). Import it here rather than
        # at module top so merely importing this module — for CATEGORY_COLORS_BGR,
        # MODELS, create_detector, etc. — doesn't load torch. It's loaded only when
        # a detector is actually constructed (i.e. AI detection is really needed).
        from ultralytics import YOLO
        self._model = YOLO(_resolve_model(model_name))
        default = cfg.detection_confidence
        self._confidences = {c: confidences.get(c, default) if confidences else default
                             for c in _CATEGORIES_LIST}
        # Trigger PyTorch JIT warmup now so the first real inference isn't slow enough to timeout.
        try:
            self._model(np.zeros((320, 320, 3), dtype=np.uint8), verbose=False, imgsz=320)
        except Exception:
            pass

    def reload(self, model_name: str):
        from ultralytics import YOLO
        self._model = YOLO(_resolve_model(model_name))

    def set_category_confidence(self, category: str, value: float):
        if category in self._confidences:
            self._confidences[category] = value

    def detect(self, frame: np.ndarray) -> List[Detection]:
        min_conf = min(self._confidences.values())
        results = self._model(frame, verbose=False, conf=min_conf, imgsz=320)[0]
        detections = []
        for box in results.boxes:
            label = results.names[int(box.cls)]
            confidence = float(box.conf)
            category = CATEGORIES.get(label, "other")
            if confidence < self._confidences.get(category, min_conf):
                continue
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            detections.append(Detection(label=label, category=category, confidence=confidence, bbox=(x1, y1, x2, y2)))
        return _apply_nms(detections)

    def detect_debug(self, frame: np.ndarray, conf_floor: float = 0.02) -> List[Detection]:
        """Diagnostic pass: every raw box above conf_floor, ignoring the
        configured per-category thresholds — used to see what the model actually
        scored on a miss, not just what currently passes the filter."""
        results = self._model(frame, verbose=False, conf=conf_floor, imgsz=320)[0]
        detections = []
        for box in results.boxes:
            label = results.names[int(box.cls)]
            confidence = float(box.conf)
            category = CATEGORIES.get(label, "other")
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            detections.append(Detection(label=label, category=category, confidence=confidence, bbox=(x1, y1, x2, y2)))
        return _apply_nms(detections)


class YOLOWorldDetector:
    def __init__(self, classes: list = None, confidences: dict = None):
        try:
            from ultralytics import YOLOWorld as _YW
        except ImportError:
            raise ImportError("YOLOWorld requires ultralytics >= 8.0.43: pip install -U ultralytics")
        self._model = _YW(_resolve_model('yolov8s-worldv2.pt'))
        self._classes = list(classes) if classes else list(DEFAULT_WILDLIFE_CLASSES)
        self._model.set_classes(self._classes)
        default = cfg.detection_confidence
        self._confidences = {c: confidences.get(c, default) if confidences else default
                             for c in _CATEGORIES_LIST}

    def set_category_confidence(self, category: str, value: float):
        if category in self._confidences:
            self._confidences[category] = value

    def detect(self, frame: np.ndarray) -> List[Detection]:
        min_conf = min(self._confidences.values())
        results = self._model(frame, verbose=False, conf=min_conf, imgsz=320)[0]
        detections = []
        for box in results.boxes:
            cls_idx = int(box.cls)
            if cls_idx >= len(self._classes):
                continue
            label = self._classes[cls_idx]
            confidence = float(box.conf)
            category = _classify_open_vocab(label)
            if confidence < self._confidences.get(category, min_conf):
                continue
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            detections.append(Detection(label=label, category=category, confidence=confidence, bbox=(x1, y1, x2, y2)))
        return _apply_nms(detections)

    def detect_debug(self, frame: np.ndarray, conf_floor: float = 0.02) -> List[Detection]:
        """Diagnostic pass: every raw box above conf_floor, ignoring the
        configured per-category thresholds — used to see what the model actually
        scored on a miss, not just what currently passes the filter."""
        results = self._model(frame, verbose=False, conf=conf_floor, imgsz=320)[0]
        detections = []
        for box in results.boxes:
            cls_idx = int(box.cls)
            if cls_idx >= len(self._classes):
                continue
            label = self._classes[cls_idx]
            confidence = float(box.conf)
            category = _classify_open_vocab(label)
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            detections.append(Detection(label=label, category=category, confidence=confidence, bbox=(x1, y1, x2, y2)))
        return _apply_nms(detections)


class MegaDetectorDetector:
    _MODEL_URL = "https://github.com/microsoft/CameraTraps/releases/download/v5.0/md_v5a.0.0.pt"
    _MODEL_FILE = "md_v5a.0.0.pt"
    _CATEGORY_MAP = {"animal": "animals", "person": "people", "vehicle": "vehicles"}

    def __init__(self, confidences: dict = None):
        path = self._ensure_model()
        try:
            import importlib, sys, yolov5
            # backend/models/ shadows yolov5's models package in sys.path.
            # Swap it for the duration of torch.load so pickle resolves classes correctly.
            # Safe: all service code uses `from models.database import X` which is
            # already cached in sys.modules['models.database'] and is unaffected.
            _orig = sys.modules.get('models')
            sys.modules['models'] = importlib.import_module('yolov5.models')
            try:
                self._model = yolov5.load(path, verbose=False)
            finally:
                if _orig is not None:
                    sys.modules['models'] = _orig
                else:
                    sys.modules.pop('models', None)
        except Exception as e:
            raise RuntimeError(f"MegaDetector failed to load: {e}") from e
        self._model.eval()
        default = cfg.detection_confidence
        self._confidences = {c: confidences.get(c, default) if confidences else default
                             for c in _CATEGORIES_LIST}
        try:
            self._model(np.zeros((640, 640, 3), dtype=np.uint8), size=640)
        except Exception:
            pass

    def _ensure_model(self) -> str:
        import urllib.request
        path = os.path.join(_models_dir(), self._MODEL_FILE)
        if not os.path.exists(path):
            urllib.request.urlretrieve(self._MODEL_URL, path)
        return path

    def set_category_confidence(self, category: str, value: float):
        if category in self._confidences:
            self._confidences[category] = value

    def detect(self, frame: np.ndarray) -> List[Detection]:
        min_conf = min(self._confidences.values())
        self._model.conf = min_conf
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self._model(frame_rgb, size=640)
        names = results.names
        detections = []
        for row in results.xyxy[0].tolist():
            x1, y1, x2, y2, confidence, cls_idx = row
            label = names[int(cls_idx)]
            confidence = float(confidence)
            category = self._CATEGORY_MAP.get(label, 'other')
            if confidence < self._confidences.get(category, min_conf):
                continue
            detections.append(Detection(
                label=label, category=category, confidence=confidence,
                bbox=(int(x1), int(y1), int(x2), int(y2)),
            ))
        return _apply_nms(detections)

    def detect_debug(self, frame: np.ndarray, conf_floor: float = 0.02) -> List[Detection]:
        """Diagnostic pass: every raw box above conf_floor, ignoring the
        configured per-category thresholds — used to see what the model actually
        scored on a miss, not just what currently passes the filter."""
        self._model.conf = conf_floor
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self._model(frame_rgb, size=640)
        names = results.names
        detections = []
        for row in results.xyxy[0].tolist():
            x1, y1, x2, y2, confidence, cls_idx = row
            label = names[int(cls_idx)]
            category = self._CATEGORY_MAP.get(label, 'other')
            detections.append(Detection(
                label=label, category=category, confidence=float(confidence),
                bbox=(int(x1), int(y1), int(x2), int(y2)),
            ))
        return _apply_nms(detections)


class OWLv2Detector:
    def __init__(self, classes: list = None, confidences: dict = None):
        try:
            from transformers import Owlv2Processor, Owlv2ForObjectDetection
        except ImportError:
            raise ImportError("OWLv2 requires transformers: pip install transformers torch Pillow")
        import torch
        self._processor = Owlv2Processor.from_pretrained("google/owlv2-base-patch16")
        self._owlmodel = Owlv2ForObjectDetection.from_pretrained("google/owlv2-base-patch16")
        self._owlmodel.eval()
        self._classes = list(classes) if classes else list(DEFAULT_WILDLIFE_CLASSES)
        self._texts = [[f"a {c}" for c in self._classes]]
        default = cfg.detection_confidence
        self._confidences = {c: confidences.get(c, default) if confidences else default
                             for c in _CATEGORIES_LIST}

    def set_category_confidence(self, category: str, value: float):
        if category in self._confidences:
            self._confidences[category] = value

    def detect(self, frame: np.ndarray) -> List[Detection]:
        from PIL import Image
        import torch
        h, w = frame.shape[:2]
        image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        min_conf = min(self._confidences.values())
        inputs = self._processor(text=self._texts, images=image, return_tensors="pt")
        with torch.no_grad():
            outputs = self._owlmodel(**inputs)
        target_sizes = torch.Tensor([[h, w]])
        results = self._processor.post_process_object_detection(
            outputs=outputs, threshold=min_conf, target_sizes=target_sizes
        )[0]
        detections = []
        for box, score, label_idx in zip(
            results["boxes"].tolist(),
            results["scores"].tolist(),
            results["labels"].tolist(),
        ):
            if label_idx >= len(self._classes):
                continue
            label = self._classes[label_idx]
            confidence = float(score)
            category = _classify_open_vocab(label)
            if confidence < self._confidences.get(category, min_conf):
                continue
            x1, y1, x2, y2 = map(int, box)
            detections.append(Detection(label=label, category=category, confidence=confidence, bbox=(x1, y1, x2, y2)))
        return _apply_nms(detections)

    def detect_debug(self, frame: np.ndarray, conf_floor: float = 0.02) -> List[Detection]:
        """Diagnostic pass: every raw box above conf_floor, ignoring the
        configured per-category thresholds — used to see what the model actually
        scored on a miss, not just what currently passes the filter."""
        from PIL import Image
        import torch
        h, w = frame.shape[:2]
        image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        inputs = self._processor(text=self._texts, images=image, return_tensors="pt")
        with torch.no_grad():
            outputs = self._owlmodel(**inputs)
        target_sizes = torch.Tensor([[h, w]])
        results = self._processor.post_process_object_detection(
            outputs=outputs, threshold=conf_floor, target_sizes=target_sizes
        )[0]
        detections = []
        for box, score, label_idx in zip(
            results["boxes"].tolist(),
            results["scores"].tolist(),
            results["labels"].tolist(),
        ):
            if label_idx >= len(self._classes):
                continue
            label = self._classes[label_idx]
            category = _classify_open_vocab(label)
            x1, y1, x2, y2 = map(int, box)
            detections.append(Detection(label=label, category=category, confidence=float(score), bbox=(x1, y1, x2, y2)))
        return _apply_nms(detections)


class GroundingDINODetector:
    def __init__(self, classes: list = None, confidences: dict = None):
        try:
            from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        except ImportError:
            raise ImportError("Grounding DINO requires transformers: pip install transformers torch Pillow")
        self._processor = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-tiny")
        self._dinomodel = AutoModelForZeroShotObjectDetection.from_pretrained("IDEA-Research/grounding-dino-tiny")
        self._dinomodel.eval()
        self._classes = list(classes) if classes else list(DEFAULT_WILDLIFE_CLASSES)
        self._text = ". ".join(self._classes) + "."
        default = cfg.detection_confidence
        self._confidences = {c: confidences.get(c, default) if confidences else default
                             for c in _CATEGORIES_LIST}

    def set_category_confidence(self, category: str, value: float):
        if category in self._confidences:
            self._confidences[category] = value

    def detect(self, frame: np.ndarray) -> List[Detection]:
        from PIL import Image
        import torch
        h, w = frame.shape[:2]
        image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        min_conf = min(self._confidences.values())
        inputs = self._processor(images=image, text=self._text, return_tensors="pt")
        with torch.no_grad():
            outputs = self._dinomodel(**inputs)
        results = self._processor.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            threshold=min_conf,
            text_threshold=0.25,
            target_sizes=[(h, w)],
        )[0]
        detections = []
        for box, score, label in zip(
            results["boxes"].tolist(),
            results["scores"].tolist(),
            results["labels"],
        ):
            label_str = label.strip().lower()
            confidence = float(score)
            category = _classify_open_vocab(label_str)
            if confidence < self._confidences.get(category, min_conf):
                continue
            x1, y1, x2, y2 = map(int, box)
            detections.append(Detection(label=label_str, category=category, confidence=confidence, bbox=(x1, y1, x2, y2)))
        return _apply_nms(detections)

    def detect_debug(self, frame: np.ndarray, conf_floor: float = 0.02) -> List[Detection]:
        """Diagnostic pass: every raw box above conf_floor, ignoring the
        configured per-category thresholds — used to see what the model actually
        scored on a miss, not just what currently passes the filter."""
        from PIL import Image
        import torch
        h, w = frame.shape[:2]
        image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        inputs = self._processor(images=image, text=self._text, return_tensors="pt")
        with torch.no_grad():
            outputs = self._dinomodel(**inputs)
        results = self._processor.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            threshold=conf_floor,
            text_threshold=0.25,
            target_sizes=[(h, w)],
        )[0]
        detections = []
        for box, score, label in zip(
            results["boxes"].tolist(),
            results["scores"].tolist(),
            results["labels"],
        ):
            label_str = label.strip().lower()
            category = _classify_open_vocab(label_str)
            x1, y1, x2, y2 = map(int, box)
            detections.append(Detection(label=label_str, category=category, confidence=float(score), bbox=(x1, y1, x2, y2)))
        return _apply_nms(detections)


def create_detector(model_key: str, classes: list = None, confidences: dict = None):
    """Factory — returns the right detector for the given model key."""
    key = model_key.removesuffix('.pt') if model_key.endswith('.pt') else model_key
    if key in ('yolov8n', 'yolov8s', 'yolov8m'):
        return ObjectDetector(f'{key}.pt', confidences=confidences)
    if key == 'yolov8s-worldv2':
        return YOLOWorldDetector(classes=classes, confidences=confidences)
    if key == 'megadetector':
        return MegaDetectorDetector(confidences=confidences)
    if key == 'owlv2':
        return OWLv2Detector(classes=classes, confidences=confidences)
    if key == 'grounding-dino':
        return GroundingDINODetector(classes=classes, confidences=confidences)
    # Fallback: treat as a raw filename
    return ObjectDetector(model_key if '.' in model_key else f'{model_key}.pt', confidences=confidences)
