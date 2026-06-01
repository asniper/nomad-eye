# Face Recognition

Nomad Eye can identify known faces in the detection stream and tag events with the person's name. All processing is local — no faces are sent to any external service.

---

## Enabling Face Recognition

**Settings → AI → Detection Categories → Faces**

Face recognition has two operating modes depending on which other detection categories are enabled:

**Faces-only mode** (recommended for dedicated face recognition): disable all other detection categories (people, vehicles, animals, other) and leave only Faces enabled. The system skips YOLO entirely and runs face detection directly on each frame at higher resolution. This is faster and more accurate for face recognition since no CPU budget is spent on object detection.

**Mixed mode**: when other categories are also enabled, face detection runs in parallel with YOLO. It first attempts a full-frame scan, then falls back to cropping any detected `person` bounding boxes and re-running detection on the upscaled head region.

In both modes, face detection automatically enhances contrast (CLAHE) before running, which improves detection under IR/night vision and when wearing glasses.

Enabling face recognition adds CPU overhead. On ARM64, expect a 20–40% increase in per-frame processing time.

---

## Capturing Faces

When the system detects a person, any visible face in the frame is automatically cropped and stored as a candidate. You can promote candidates into your face library.

**To capture a face manually:**

1. Go to **Detections** and find an event showing the person's face clearly
2. Click the event to open it
3. Click **Capture Face** on the face crop shown in the event
4. Enter the person's name and click **Save**

The face embedding is computed and added to the library. Future detections will be compared against it.

---

## Building a Face Library

A face library entry consists of a name and one or more face embeddings. Multiple captures for the same person improve recognition accuracy, especially across different lighting conditions, angles, or distances.

**Recommended:** capture 3–5 images per person, from different angles and lighting conditions.

**People → Face Library** — shows all named entries with their captures and recognition stats.

---

## Merging Duplicate Entries

If the same person was added twice under different names, you can merge them:

1. Go to **People → Face Library**
2. Open one of the duplicate entries
3. Click **Merge With…** and select the entry to merge into
4. Confirm — embeddings from both entries are combined under the target name

---

## Disassociating Misidentified Faces

If a detection was tagged with the wrong person:

1. Go to **Detections** and open the event
2. Click the face tag shown in the event
3. Click **Not This Person** — the association is removed and the face is returned to unidentified candidates

If the face was used to train a library entry (i.e., you captured it), you should also go to **People → Face Library → [Person] → Captures** and delete the incorrect capture so it doesn't continue to cause misidentifications.

---

## Performance Notes

- In faces-only mode, YOLO is skipped entirely — lower CPU use, better face detection resolution
- In mixed mode, face detection runs in parallel with YOLO; a motion-region crop fallback retries every 8 seconds if the full-frame scan finds nothing
- Face detections are not subject to per-pixel motion filtering — a face is reported regardless of whether the face region itself is moving
- The similarity threshold controls how strict matches must be; lower values allow more uncertain matches (**Settings → AI → Face Recognition → Similarity Threshold**)
- On devices with under 2 GB RAM, running face recognition alongside multiple cameras and YOLOWorld may cause memory pressure; monitor with `htop`
- Face library size has minimal impact on performance; embedding comparison is fast even with hundreds of entries
- For best results with glasses or IR/night vision, add face samples captured in those conditions — the system auto-saves unrecognized faces as "Unknown" which you can rename to build samples for difficult conditions
