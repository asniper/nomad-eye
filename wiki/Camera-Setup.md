# Camera Setup

Nomad Eye uses OpenCV to capture from UVC-compatible USB cameras. Most modern USB webcams and USB capture cards are UVC-compatible.

---

## Connecting a Camera

1. Plug the USB camera into your device.
2. The camera should appear as a `/dev/video*` device (e.g., `/dev/video0`).
3. Open the web UI → **Cameras**.
4. Click **Scan for Cameras** — Nomad Eye will detect available video devices.
5. Click **Enable** on the camera you want to use.
6. Give it a name (e.g., "Front Door") and click **Save**.

The camera will begin streaming immediately. If it doesn't appear, see [Troubleshooting](Troubleshooting).

---

## USB Bandwidth Notes

USB cameras share bandwidth on the USB bus. This becomes a problem when connecting multiple cameras to the same physical port or hub.

**Rules of thumb:**

- USB 3.0 cameras at 1080p/30fps: maximum 2 on a single controller without frame drops
- USB 2.0 cameras at 720p/30fps: typically fine for 2–3 on the same hub
- If cameras share a USB hub, bandwidth is split; high-resolution cameras will compete

**To reduce bandwidth per camera:**

- Lower the resolution in camera settings (480p is fine for most detection use cases)
- Lower the frame rate (15fps is adequate for detection; motion buffer still records at full rate)
- Use multiple USB controllers if available — check with `lsusb -t`

If you see frozen frames, stuttering, or OpenCV errors in the logs, USB bandwidth is the most common cause.

---

## Enabling and Disabling Cameras

**Enable:** Cameras → toggle the camera on. The stream and detection pipeline start immediately.

**Disable:** Toggle off. The device is released; OpenCV stops reading from it. No detections or clips are recorded while disabled.

Cameras retain their settings (name, resolution, detection config) when disabled. Re-enabling picks up where it left off.

---

## Camera Settings

For each camera you can configure:

| Setting | Description |
|---|---|
| **Name** | Display name shown in the UI and used in notification messages |
| **Resolution** | Capture resolution; lower = less CPU and USB bandwidth |
| **Frame rate** | Capture FPS; 15fps is usually enough for detection |
| **Rotation** | Rotate the stream 0°, 90°, 180°, or 270° if the camera is mounted sideways |
| **Detection enabled** | Run AI detection on this camera's stream |
| **Motion detection** | Trigger on pixel-level motion before running AI inference |

---

## Reloading Cameras

If you unplug and replug a camera, or connect a new one, use **Cameras → Reload** to re-scan without restarting the service.

---

## Resetting a Camera

If a camera gets into a bad state (stream shows black, high CPU), use **Cameras → Reset** to close and reopen the OpenCV capture handle. This is faster than a full service restart.

---

## Multiple Cameras

Each camera runs its own capture and detection pipeline. On ARM64 devices with limited CPU, running more than 2–3 cameras with full AI detection enabled will saturate the processor. Options:

- Enable AI detection only on cameras covering entry points; use motion-only on others
- Use the lightest model (`yolov8n`) when running multiple cameras
- Lower resolution on secondary cameras
