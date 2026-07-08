# Storage

Detection images and video clips can be stored on the device's internal storage or on an external USB drive or SD card. Nomad Eye tracks storage usage and can purge old detections automatically.

---

## Video Clips

When a detection event starts, Nomad Eye begins recording a video clip. The clip includes a pre-roll buffer (frames captured before the trigger) and keeps recording for a configurable post-roll period after the last motion, up to a hard duration cap. Clip recording is off by default — enable it in Settings → Storage → Video Clips.

| Property | Value |
|---|---|
| Format | H.264 MP4 (browser-playable) |
| Resolution | 640×360 |
| Frame rate | 5 fps |
| Max duration | 2 minutes (hard cap regardless of ongoing motion) |
| Pre-roll | Configurable (default 5 s) |
| Post-roll | Configurable (default 10 s after last motion) |

Clips are recorded using OpenCV and then converted to H.264 using `ffmpeg` (system package) for browser compatibility. The raw intermediate file is replaced in-place; only the final H.264 file is stored.

You can watch clips inline and download them from the **Event Detail** page. Clips can also be deleted individually without deleting the event.

---

## Internal vs External Storage

By default, Nomad Eye stores files in `/opt/nomad-eye/data/`. On most devices this is on the internal eMMC or SD card.

External storage (a USB drive or additional SD card) is useful when:

- The internal storage is small (16 GB fills up quickly with video clips)
- You want to remove and read the storage on another device
- You want longer retention without manual purging

---

## Mounting a USB Drive

1. Plug in the USB drive
2. **Settings → Storage → External Storage Devices → Scan**
3. The drive should appear with its device path (e.g., `/dev/sda1`)
4. Click **Mount** — Nomad Eye will mount it to `/mnt/nomadeye-<id>/`

The mount operation uses the storage helper script (`deploy/storage-helper.sh`) which requires passwordless sudo. See [Installation → Sudo Helper Setup](Installation#sudo-helper-setup).

---

## Formatting a Drive

> **This erases all data on the drive.**

1. **Settings → Storage → External Storage Devices** → select the drive
2. Click **Format**, then **Confirm Format**

> **Note:** If the format operation fails with "is mounted; will not make a filesystem here!", the Nomad Eye service has open file handles on the drive (e.g. actively writing a clip). Stop the service first: `sudo systemctl stop nomad-eye-backend`, then format from the UI or manually with `sudo mkfs.ext4 -F /dev/sdX1`, then restart: `sudo systemctl start nomad-eye-backend`.

Nomad Eye formats drives as ext4. FAT32/exFAT drives can be mounted and read, but ext4 is recommended for better performance and Linux permissions support.

---

## Setting Primary Storage

Images and video clips can be routed to different storage devices independently, on the same **External Storage Devices** card:

**Settings → Storage → External Storage Devices → [Drive] → Use for Images**
**Settings → Storage → External Storage Devices → [Drive] → Use for Videos**

After setting primary storage:

- New images or clips write to the selected device's mount point (`/mnt/nomadeye-<id>/nomadeye/images/` or `.../clips/`)
- Existing data on the previous primary storage is not moved automatically
- If the drive is disconnected, Nomad Eye falls back to internal storage automatically and logs a warning

To revert to internal storage: **Settings → Storage → Storage Location → Switch to Internal**

---

## Storage Stats

The **Storage** card on **Settings → Storage** shows:

| Metric | Description |
|---|---|
| Total detections | Number of detection events in the database |
| Disk usage | Used / total / free space on the primary storage device |
| Detection images | Total size of stored snapshots |
| Per-category counts | Number of detection events by category (people, vehicles, animals, etc.) |

---

## Purging Detections

The **Purge Detections** section on the same **Storage** card lets you delete detection records:

1. Pick a category (or **all**)
2. Optionally toggle **Delete images only** to keep the detection records but free up image storage
3. Click **Purge**, then **Confirm**

This deletes every matching record (and its images/clips) — there's no age or date filter, so it purges everything in the selected category, not just old events. Purge is permanent; consider copying clips to another device first if you need to keep them.

**Disk threshold auto-purge:** When the clips storage device exceeds 90% capacity, Nomad Eye automatically deletes the oldest clips until usage falls below the threshold. This prevents the disk from filling up entirely during continuous detection. The threshold is configurable via the `clips_purge_threshold` database key (default `90`). This is the only *age-based* (oldest-first) purge behavior in the app.

---

## Unmounting a Drive

Before physically removing an external drive:

**Settings → Storage → External Storage Devices → [Drive] → Unmount**

Removing a drive without unmounting may corrupt files that are currently being written.
