# AI Detection

Nomad Eye uses YOLO-based object detection models running on-device via ONNX. No internet connection is required for inference.

---

## Models

| Model | Classes | ARM64 | x86-64 | Speed | Accuracy | Notes |
|---|---|---|---|---|---|---|
| `yolov8n` | 80 COCO | Yes | Yes | Fastest | Good | Default. Best for ARM devices. |
| `yolov8s` | 80 COCO | Yes | Yes | Fast | Better | Good balance on ARM. |
| `yolov8m` | 80 COCO | Yes | Yes | Slow | Best | Not recommended on ARM. |
| `yolov8s-worldv2` / YOLOWorld | Custom (open-vocab) | Yes | Yes | Moderate | Good | Define your own detection classes. |
| MegaDetector v5 | Wildlife | No | Yes | Moderate | Excellent | x86-64 only. Best for wildlife cameras. |
| OWLv2 / Grounding DINO | Custom (open-vocab) | No | Yes | Slow | Excellent | x86-64 only. Requires ~2 GB extra (transformers). |

---

## Selecting a Model

**Settings → AI Model → Select Model**

After changing the model, the detection pipeline restarts automatically. On ARM devices, stick to `yolov8n` or `yolov8s`. The `m` variant is noticeably slower and typically not worth the accuracy gain for live video.

---

## COCO-80 Classes

The standard YOLO models (`yolov8n/s/m`) detect the 80 COCO object categories. The most security-relevant ones:

- **Person**
- **Car**, **Truck**, **Bus**, **Motorcycle**, **Bicycle**
- **Dog**, **Cat**, **Bird**, **Horse**, **Cow**
- **Backpack**, **Suitcase**, **Handbag**

You can filter notifications by category without filtering detection — all classes are still detected and stored; rules control what triggers an alert.

---

## Open-Vocab Classes (YOLOWorld)

YOLOWorld (`yolov8s-worldv2`) lets you define arbitrary text-based classes instead of being limited to COCO-80.

**Settings → AI Model → YOLOWorld Classes**

Enter a comma-separated list of class names:

```
person, dog, fox, deer, raccoon, car
```

Keep the list short (under 20 classes) for best performance. Vague or overlapping class names reduce accuracy.

---

## Confidence Threshold

The confidence threshold determines how certain the model must be before registering a detection. Lower values catch more (including false positives); higher values only report high-confidence detections.

**Global threshold:** Set in `.env` as `DETECTION_CONFIDENCE`, or in **Settings → Detection → Confidence**.

**Per-category thresholds:** You can override the global threshold per class in **Settings → Detection → Category Thresholds**. For example, set `person` to 0.6 and `bird` to 0.8 to reduce false positives from birds.

Typical values:

| Use case | Threshold |
|---|---|
| Indoors, controlled lighting | 0.55–0.65 |
| Outdoors, good lighting | 0.45–0.55 |
| Night/IR camera | 0.35–0.50 |

---

## Motion Threshold

Detection inference only runs when motion is detected first. This saves CPU significantly.

`MOTION_THRESHOLD` is the number of changed pixels between frames required to trigger inference. Default is `500`.

- Too low → inference runs constantly, high CPU
- Too high → slow-moving subjects (approaching person) may not trigger

Adjust in **Settings → Detection → Motion Threshold** or via `.env`.

---

## ARM vs x86-64 Performance

On ARM64 (e.g., Arduino Uno Q) without a GPU, inference runs on the CPU via ONNX Runtime.

| Model | Approx. inference time (ARM64, single camera) |
|---|---|
| yolov8n | ~80–120ms |
| yolov8s | ~200–350ms |
| yolov8m | ~600ms+ |

At these speeds, yolov8n and yolov8s can comfortably keep up with 15fps streams. yolov8m will cause frame-level delays.

x86-64 machines are generally fast enough for any model. If a GPU is available, ONNX Runtime will use it automatically.

---

## Detection Events

When a detection passes the confidence threshold:

1. A snapshot image is saved to `IMAGES_DIR`
2. The pre-event video buffer is flushed to `CLIPS_DIR` (default: last 5 seconds)
3. Recording continues for `CLIP_SECONDS_AFTER` (default: 5 seconds)
4. Any matching notification rules are evaluated and fired

Events are viewable in **Detections** in the web UI, with the snapshot and a clip player.
