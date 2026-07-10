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

## Continuous Recording

Off by default — enable it in **Settings → Storage → Continuous Recording**. Unlike event clips, this records constantly, not just around detected events — it's for reviewing what happened in the gaps between events.

| Property | Value |
|---|---|
| Format | H.264 MP4, same encoding pipeline as event clips |
| Resolution | 640×360 @ 5 fps (ambient footage, not forensic-quality) |
| Segment length | 5 minutes per file |
| Overlay | Same camera name / timestamp / detection-box burn-in as event clips and snapshots |

Click **Edit Camera** on a camera's card (Cameras page) to open that camera's own page, which lands on the Continuous tab: a shared video viewer at the top (live feed by default), a summary of how much footage is retained (segment count, approximate total duration, storage used, oldest recording), and a day timeline below it. The timeline shows one block per 5-minute segment positioned by time of day, with gaps where nothing was recorded; use **Prev**/**Next** to browse other days. Click a block to play that segment in the viewer above — a **Live Mode** button appears on the viewer to switch back to the live feed (which pauses while a recording plays).

Selecting a segment also gives you:

- **Prev / Next** — step to the adjacent segment in the same day without going back to the timeline. When a segment finishes playing, the next one starts automatically — useful for watching through a stretch of time without clicking through each 5-minute file individually. (Auto-advance and Prev/Next only work within the currently loaded day; a segment played from Locked Recordings below, since it can be from any day, plays on its own with no next/prev.)
- **Lock** — exempts that segment from the disk-threshold auto-purge below, so it survives even after older footage gets deleted. A locked segment can still be deleted manually — locking only protects against the automatic purge.
- **Download** — saves that segment's video file locally.
- **Delete** — removes it immediately (asks for confirmation; extra confirmation if it's locked).

Below the timeline, **Locked Recordings** lists every locked segment for that camera regardless of which day it's from — so a clip you locked days or weeks ago doesn't get lost in day-by-day browsing. Click one to play it the same way as a timeline block.

**This uses meaningfully more storage than event clips alone** — it's recording all the time, not just when something happens. It requires external storage (same as event clips; nothing is ever written to internal storage), and unlocked continuous segments are purged oldest-first, ahead of event clips, once the disk-threshold purge below kicks in — so turning this on doesn't put your actual detection history at risk of being purged first.

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
- If the images drive is disconnected, Nomad Eye falls back to internal storage automatically
- Clips are external-only — if the clips drive is disconnected or unmounted, clip/continuous recording simply stops (nothing is written to internal storage) until the drive is reconnected and mounted again

To revert to internal storage: **Settings → Storage → Storage Location → Switch to Internal**

Whichever devices are set as the images and/or clips primary are remembered across restarts — Nomad Eye automatically re-mounts them on startup, whether that's a service restart or a full device reboot, so recording resumes on the same drive without needing to re-mount it manually from Settings. If the drive isn't detected yet at startup (e.g. the kernel is still enumerating USB devices right after a reboot), it retries for about a minute before giving up.

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

**Disk threshold auto-purge:** When the clips storage device exceeds 90% capacity, Nomad Eye automatically deletes the oldest recordings until usage falls below the threshold. Continuous recording segments are purged first (bulk, lower-value ambient footage), and only once none are left does it fall back to purging event clips (each tied to an actual detection). This prevents the disk from filling up entirely during continuous operation. The threshold is configurable via the `clips_purge_threshold` database key (default `90`). This is the only *age-based* (oldest-first) purge behavior in the app.

---

## Unmounting a Drive

Before physically removing an external drive:

**Settings → Storage → External Storage Devices → [Drive] → Unmount**

Removing a drive without unmounting may corrupt files that are currently being written.
