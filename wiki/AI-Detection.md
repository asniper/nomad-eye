# AI Detection

Nomad Eye runs several on-device object detection models: standard YOLO models, open-vocabulary YOLOWorld, and MegaDetector (all PyTorch, via `ultralytics`/`yolov5`), plus optional open-vocabulary transformer models (OWLv2, Grounding DINO, via `transformers`). An `.onnx` export of the active model is used automatically for a speed boost if one is present alongside the `.pt` weights and its input shape matches. No internet connection is required for inference once a model is downloaded.

---

## Models

| Model | Classes | ARM64 | x86-64 | Speed | Accuracy | Notes |
|---|---|---|---|---|---|---|
| `yolov8n` | 80 COCO | Yes | Yes | Fastest | Good | Default. Best for ARM devices. |
| `yolov8s` | 80 COCO | Yes | Yes | Fast | Better | Good balance on ARM. |
| `yolov8m` | 80 COCO | Yes | Yes | Slow | Best | Not recommended on ARM. |
| `yolov8s-worldv2` / YOLOWorld | Custom (open-vocab) | Yes | Yes | Moderate | Good | Define your own detection classes. |
| MegaDetector v5 | Wildlife | No | Yes | Moderate | Excellent | Best for wildlife cameras. ~220 MB download on first use. |
| OWLv2 / Grounding DINO | Custom (open-vocab) | No | Yes | Slow | Excellent | Requires manually running `pip install transformers` (~2 GB) in the backend venv first — the app does not install this for you. |

The ARM64/x86-64 column is advisory, not enforced: the UI greys out MegaDetector/OWLv2/Grounding DINO on ARM because they're impractically slow there (OWLv2/DINO can take 10–30s per scan on CPU), not because the code refuses to run them.

---

## Selecting a Model

**Settings → Detection → Detection Model**

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

YOLOWorld (`yolov8s-worldv2`), OWLv2, and Grounding DINO all let you define arbitrary text-based classes instead of being limited to COCO-80 — the same class list setting applies to whichever open-vocabulary model is active.

**Settings → Detection → Detection Model → Detection classes**

Enter a comma-separated list of class names:

```
person, dog, fox, deer, raccoon, car
```

Keep the list short (under 20 classes) for best performance. Vague or overlapping class names reduce accuracy.

---

## Confidence Threshold

The confidence threshold determines how certain the model must be before registering a detection. Lower values catch more (including false positives); higher values only report high-confidence detections.

There's one threshold per category (people, vehicles, animals, other, faces) — no single global value. Adjust them in **Settings → Detection → Confidence thresholds**. For example, set `person` to 0.6 and `animals` to 0.8 to reduce false positives from wildlife.

Typical values:

| Use case | Threshold |
|---|---|
| Indoors, controlled lighting | 0.55–0.65 |
| Outdoors, good lighting | 0.45–0.55 |
| Night/IR camera | 0.35–0.50 |

---

## Motion Threshold

Detection inference only runs when motion is detected first. This saves CPU significantly.

Motion threshold is the pixel-change area required to trigger inference. The shipped default is `100`, not the `500` fallback baked into the code — a fresh install seeds the lower value.

- Too low → inference runs constantly, high CPU
- Too high → slow-moving subjects (approaching person) may not trigger

Adjust in **Settings → Detection → Motion threshold**. Vehicles have an extra built-in filter — a vehicle bounding box only counts as a real detection if at least 5% of its area shows actual pixel motion, so a parked car sitting in frame doesn't create endless events. This filter doesn't apply to faces, which are exempt from motion gating entirely (they still require the camera's motion detector to have fired at all, per [Face Recognition](Face-Recognition)).

---

## Detection Zones

Off by default — turn it on in **Settings → Detection → Detection zones**, then draw zones per camera on that camera's own page (click **Zones** on its card from the **Cameras** page).

A zone is a polygon you draw over a snapshot of that camera's view, one of two types:

- **Exclude zone** — detections whose center point falls inside are dropped entirely. Optionally scoped to specific categories; leave categories unchecked to apply to everything.
- **Include zone** — restricts a category to *only* count inside the zone. If you draw an include zone scoped to `people`, people detected anywhere outside it are ignored — but other categories with no matching include zone remain unrestricted.

**A stationary object that keeps false-positiving as a moving vehicle** (a parked trailer, a boat on a trailer, anything permanently sitting where the vehicle motion filter above isn't quite catching it) is exactly what an exclude zone scoped to `vehicles` is for: draw a tight polygon around that spot, and any vehicle-category detection centered there gets dropped before it can ever create an event — regardless of how much pixel-level motion noise (shadows, IR flicker, wind) happens to trigger the underlying motion/YOLO pass. This layers on top of the 5%-motion-ratio filter, not instead of it; if the trailer is still slipping through despite that filter, a zone is the more reliable fix since it doesn't depend on tuning a global sensitivity number that also affects every other vehicle on that camera.

Zones don't affect the motion detector itself or the live overlay — they filter *after* a detection has already been made, right before it would become an event. A detection dropped by a zone never creates a database record, screenshot, clip, or notification.

---

## ARM vs x86-64 Performance

On ARM64 (e.g., Arduino Uno Q) without a GPU, inference runs on the CPU via PyTorch (through `ultralytics`), or via ONNX Runtime if a matching `.onnx` export is present.

| Model | Approx. inference time (ARM64, single camera) |
|---|---|
| yolov8n | ~80–120ms |
| yolov8s | ~200–350ms |
| yolov8m | ~600ms+ |

At these speeds, yolov8n and yolov8s can comfortably keep up with 15fps streams. yolov8m will cause frame-level delays.

x86-64 machines are generally fast enough for any model.

---

## Detection Events

When a detection passes the confidence threshold:

1. A snapshot image is saved, overlaid with the camera name, timestamp, and detection labels
2. Any matching notification rules are evaluated and fired
3. If video clip recording is enabled (Settings → Storage → Video Clips — off by default), the pre-roll buffer (default: last 5 seconds) is written to the clip and recording continues for the post-roll duration (default: 10 seconds after the last motion) with the same overlay burned into every frame

Events are viewable in **Detections** in the web UI, with the snapshot and, if recorded, a clip player.
