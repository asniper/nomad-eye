# Storage

Detection images and video clips can be stored on the device's internal storage or on an external USB drive or SD card. Nomad Eye tracks storage usage and can purge old detections automatically.

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
2. **Storage → External Drives → Scan**
3. The drive should appear with its device path (e.g., `/dev/sda1`)
4. Click **Mount** — Nomad Eye will mount it to `/mnt/nomad-eye-<id>/`

The mount operation uses the storage helper script (`deploy/storage-helper.sh`) which requires passwordless sudo. See [Installation → Sudo Helper Setup](Installation#sudo-helper-setup).

---

## Formatting a Drive

> **This erases all data on the drive.**

1. **Storage → External Drives** → select the drive
2. Click **Format as ext4**
3. Confirm the operation

Nomad Eye formats drives as ext4. FAT32/exFAT drives can be mounted and read, but ext4 is recommended for better performance and Linux permissions support.

---

## Setting Primary Storage

Primary storage is where new detection images and clips are written.

**Storage → External Drives → [Drive] → Set as Primary**

After setting primary storage:

- `IMAGES_DIR` and `CLIPS_DIR` effective paths change to the external mount point
- Existing data on the previous primary storage is not moved automatically
- If the drive is disconnected, Nomad Eye falls back to internal storage automatically and logs a warning

To revert to internal storage:

**Storage → Internal Storage → Set as Primary**

---

## Storage Stats

**Storage → Overview** shows:

| Metric | Description |
|---|---|
| Total detections | Number of detection events in the database |
| Images | Total size of stored snapshots |
| Clips | Total size of stored video clips |
| Free space | Available space on the primary storage device |
| Estimated days remaining | Based on current recording rate and free space |

---

## Purging Old Detections

**Storage → Purge**

You can purge events older than a specified number of days. This deletes:

- The database event records
- The associated image files
- The associated video clip files

Purge is permanent. Consider copying clips to another device before purging if you need to keep them.

**Auto-purge:** You can set a retention period in **Settings → Storage → Retention Days**. Events older than this are automatically deleted daily at 2 AM.

---

## Unmounting a Drive

Before physically removing an external drive:

**Storage → External Drives → [Drive] → Unmount**

Removing a drive without unmounting may corrupt files that are currently being written.
