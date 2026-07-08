# Face Recognition

Nomad Eye can identify known faces in the detection stream and tag events with the person's name. All processing is local — no faces are sent to any external service.

---

## Enabling Face Recognition

**Settings → Detection → Confidence thresholds** — enable the **Faces** category there (each category has its own enable toggle alongside its confidence slider).

Face detection accuracy depends on which recognition backend loaded: primarily `face_recognition` (dlib-based); if that library failed to install, Nomad Eye silently falls back to a much weaker OpenCV Haar-cascade matcher. Check `GET /api/faces/backend` (or the equivalent status shown in Settings → Faces) to see which one is active — recognition accuracy is significantly better on the dlib backend.

Face recognition has two operating modes depending on which other detection categories are enabled:

**Faces-only mode** (recommended for dedicated face recognition): disable all other detection categories (people, vehicles, animals, other) and leave only Faces enabled. The system skips YOLO entirely and runs face detection directly on each frame at higher resolution. This is faster and more accurate for face recognition since no CPU budget is spent on object detection.

**Mixed mode**: when other categories are also enabled, face detection runs in parallel with YOLO. It first attempts a full-frame scan, then falls back to cropping any detected `person` bounding boxes and re-running detection on the upscaled head region.

In both modes, face detection automatically enhances contrast (CLAHE) before running, which improves detection under IR/night vision and when wearing glasses.

Enabling face recognition adds CPU overhead. On ARM64, expect a 20–40% increase in per-frame processing time.

---

## Capturing Faces

There's no manual "capture from this event" action. Instead, whenever the system detects a face that doesn't match anything already in the library, it automatically crops and saves it as an "Unknown" candidate in the background — no user action needed.

**To name a candidate:**

1. Go to **Settings → Faces**
2. Find the "Unknown" candidate among the captures
3. Assign it a name and click **Save**

The face embedding is already computed and stored; naming it just labels that embedding. Future detections will be compared against it.

---

## Building a Face Library

A face library entry consists of a name and one or more face embeddings. Multiple captures for the same person improve recognition accuracy, especially across different lighting conditions, angles, or distances.

**Recommended:** capture 3–5 images per person, from different angles and lighting conditions.

**Settings → Faces** — shows all named entries grouped with their captures, plus unassigned "Unknown" candidates.

---

## Renaming and Removing Faces

There's no dedicated "merge" flow in the UI. What you can do from **Settings → Faces**:

- **Rename** a face entry — relabels that one captured embedding. If the same person ended up under two different names, renaming the duplicate's captures to match consolidates them under one name (each embedding is still a separate row, just sharing a name).
- **Remove** — moves a named capture back to "Unknown" if it was misidentified, or deletes an "Unknown" candidate entirely.

There's no per-event "click the face tag → Not This Person" flow — corrections happen on the Settings → Faces page against the stored capture, not against a specific past detection event.

---

## Performance Notes

- In faces-only mode, YOLO is skipped entirely — lower CPU use, better face detection resolution
- In mixed mode, face detection runs in parallel with YOLO; a motion-region crop fallback retries every 8 seconds if the full-frame scan finds nothing
- Face detections are not subject to per-pixel motion filtering — a face is reported regardless of whether the face region itself is moving
- The confidence threshold controls how strict matches must be; lower values allow more uncertain matches (**Settings → Detection → Confidence thresholds → Faces**)
- Each camera also has a **Sensitivity** setting (`fast` / `normal` / `thorough`, on the Cameras page) that trades face-detection accuracy for CPU — `thorough` runs more upsample passes and is more likely to catch small/distant faces at the cost of speed
- On devices with under 2 GB RAM, running face recognition alongside multiple cameras and YOLOWorld may cause memory pressure; monitor with `htop`
- The "Unknown" candidate list is capped (oldest entries are pruned once the cap is hit) so it can't grow without bound; named face libraries are capped per person as well
- For best results with glasses or IR/night vision, add face samples captured in those conditions — the system auto-saves unrecognized faces as "Unknown" which you can rename to build samples for difficult conditions
