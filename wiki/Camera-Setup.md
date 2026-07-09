# Camera Setup

Nomad Eye uses OpenCV to capture from UVC-compatible USB cameras. Most modern USB webcams and USB capture cards are UVC-compatible.

---

## Connecting a Camera

1. Plug the USB camera into your device.
2. The camera should appear as a `/dev/video*` device (e.g., `/dev/video0`).
3. Open the web UI → **Cameras**.
4. Click **Detect Cameras** — Nomad Eye will scan for and add any new video devices, already enabled and streaming.
5. Give it a name (e.g., "Front Door") and click **Save**.

Newly-detected cameras start enabled and streaming automatically — there's no separate "Enable" step unless you'd previously disabled it. If it doesn't appear at all, see [Troubleshooting](Troubleshooting).

---

## USB Bandwidth Notes

USB cameras share bandwidth on the USB bus. This becomes a problem when connecting multiple cameras to the same physical port or hub.

**Rules of thumb:**

- USB 3.0 cameras at 1080p/30fps: maximum 2 on a single controller without frame drops
- USB 2.0 cameras at 720p/30fps: typically fine for 2–3 on the same hub
- If cameras share a USB hub, bandwidth is split; high-resolution cameras will compete

**To reduce bandwidth per camera:**

- Lower the resolution/frame rate in Settings → Detection → Cameras — this is a global setting applied to every camera, and it only takes effect while AI detection is off (AI mode forces 1280×720 @ 15fps for accurate detection)
- Use multiple USB controllers if available — check with `lsusb -t`

Nomad Eye also requests MJPEG capture by default, which cuts USB bandwidth roughly 30x versus raw YUYV — if a camera doesn't support it, capture automatically falls back to raw format after repeated read failures.

Recorded event clips are always downsampled to 640×360 @ 5fps regardless of the camera's live capture settings, so lowering clip quality isn't an option — only the live stream/detection resolution is adjustable.

If you see frozen frames, stuttering, or OpenCV errors in the logs, USB bandwidth is the most common cause.

---

## Enabling and Disabling Cameras

**Enable:** Cameras → toggle the camera on. The stream and detection pipeline start immediately.

**Disable:** Toggle off. The device is released; OpenCV stops reading from it. No detections or clips are recorded while disabled.

Cameras retain their settings (name, resolution, detection config) when disabled. Re-enabling picks up where it left off.

---

## Camera Settings

Name, Enabled, Overlay, Reload, Reset AI, and night mode are quick controls right on each camera's card on the **Cameras** page. Everything else below — Face detection, Image adjustments, Detection zones, Continuous Recording, and this camera's detection history — lives on that camera's own page: click its name, or one of the **Zones** / **Adjust** / **Face** / **Continuous** / **Recent Detections** links on its card, to get there.

For each camera you can configure:

| Setting | Description |
|---|---|
| **Name** | Display name shown in the UI and used in notification messages |
| **Enabled** | Toggle the camera's stream and detection pipeline on/off |
| **Face detection** | Per-camera enable/disable for face recognition |
| **Face sensitivity** | `fast` / `normal` / `thorough` — trades face-detection accuracy for CPU |
| **Night mode** | Hardware IR (on supported cameras) or software night-vision processing |
| **Image adjustments** | Hardware (v4l2) or software brightness/contrast controls |
| **Detection zones** | Draw include/exclude regions to ignore or restrict parts of the frame — see [AI Detection → Detection Zones](AI-Detection#detection-zones). Off by default; enable in Settings → Detection first. |

Resolution, frame rate, and AI detection on/off are **global** settings, not per-camera — see Settings → Detection. Motion detection always runs on every camera (there's no per-camera on/off); only its global sensitivity (motion threshold/scale) is adjustable. There's no rotation control.

---

## Reloading and Resetting a Camera

**Reload** (on the camera's card) closes and reopens the OpenCV capture handle — use this if a camera gets into a bad state (stream shows black, high CPU) or after unplugging and replugging it. It's faster than a full service restart.

**Reset AI** clears that camera's motion-tracking state (active events, motion bounding box) without touching the capture handle — use it if detection/overlay state looks stuck.

To scan for a newly-connected camera, use **Detect Cameras** at the top of the Cameras page — this is a global rescan, not a per-camera action.

---

## Camera Health Alerts

Off by default — turn it on in **Settings → Detection → Camera health alerts**. Presence detection (elsewhere in Settings) tracks whether *your phone* is on the network; this tracks whether *a camera itself* is still working.

If an enabled camera stops producing frames (unplugged, USB failure, driver crash) for 90 seconds or more, Nomad Eye sends a "Camera Offline" notification to every active contact through the same channels used for detections (ntfy, SMS, email) — and a "Camera Back Online" notification once it recovers. The 90-second debounce is intentional: brief USB bandwidth hiccups (see above) are common enough on this hardware that alerting on every one of them would be noise, not signal.

This detects a camera that stops responding entirely — it can't detect a camera that's still technically connected but stuck sending the same frozen frame (a driver-level hang rather than a disconnect). If a stream looks visibly frozen without ever triggering an offline alert, that's this limitation; use **Reload** on that camera manually.

Health alerts bypass the per-contact notification rules (category/time-window/frequency filters) — there's no detection category to match against a going-offline event, so every active contact gets notified regardless of their configured rules. Disabling a camera yourself (the Enabled toggle) does **not** trigger an alert; only an unexpected disconnection does.

---

## Multiple Cameras

Each camera runs its own capture and detection pipeline. On ARM64 devices with limited CPU, running more than 2–3 cameras with full AI detection enabled will saturate the processor. Options:

- Enable AI detection only on cameras covering entry points; use motion-only on others
- Use the lightest model (`yolov8n`) when running multiple cameras
- Lower resolution on secondary cameras
