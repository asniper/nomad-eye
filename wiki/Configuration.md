# Configuration

Most Nomad Eye settings are managed through the web UI and stored as key-value pairs in the SQLite database (`data/db/nomadeye.db`) — install the app, log in, and configure everything from Settings. A small number of one-time bootstrap values (initial admin credentials, secret key) are read from an optional `.env` file at `/opt/nomad-eye/.env` instead — see [Installation](Installation).

---

## Web UI Settings

| Location | What you can configure |
|---|---|
| Settings → Detection | AI model, confidence thresholds, motion threshold/scale, detection interval, per-category enable, per-camera settings |
| Settings → General | Device status, SMS/email/ntfy channel credentials (Twilio, SMTP, ntfy server) |
| Settings → General → Presence Detection | Network presence scanning, watched devices, away timeout, status mapping |
| Settings → General → Notification Links | How links in notifications point back to the device (local IP / device name / Tailscale IP) |
| Settings → Faces | Face recognition enable/disable, face library management |
| Settings → Network | WiFi networks, hotspot mode, Tailscale |
| Settings → Storage | Primary storage location, external drive management, video clip recording (enable, pre-roll, post-roll), purge old data |
| Settings → System | Timezone, OTA update channel and auto-update |
| Settings → Users | Add/remove users, change roles, reset passwords (admin only) — see [Users](Users) |
| Account menu (sidebar) | Change your own password — available to every role |
| Notifications | Contacts, notification rules, delivery log |

---

## Database Keys

Settings are stored in the `app_config` table. You can inspect them directly if needed:

```bash
sqlite3 /opt/nomad-eye/data/db/nomadeye.db "SELECT key, value FROM app_config;"
```

### Key Reference

| Key | Description |
|---|---|
| `admin_password`, `admin_username` | Legacy — no longer read for login. Kept only as one-time seed data for the `users` table on upgrade; see [Users](Users). Actual accounts live in the `users` table (hashed passwords), not `app_config`. |
| `detection_model` | Active AI model (e.g. `yolov8n`, `yolov8s-worldv2`) |
| `confidence_people` | Detection confidence threshold for people (0.0–1.0) |
| `confidence_vehicles` | Detection confidence threshold for vehicles |
| `confidence_animals` | Detection confidence threshold for animals |
| `confidence_other` | Detection confidence threshold for other objects |
| `confidence_faces` | Face recognition confidence threshold |
| `motion_threshold` | Pixel-change count required to trigger AI detection |
| `category_enabled_people` | `1` / `0` — enable detection for people |
| `category_enabled_vehicles` | `1` / `0` |
| `category_enabled_animals` | `1` / `0` |
| `category_enabled_faces` | `1` / `0` |
| `category_enabled_other` | `1` / `0` — enable detection for uncategorized objects |
| `detection_classes` | Comma-separated class names for open-vocabulary models (YOLOWorld, OWLv2, Grounding DINO) |
| `storage_primary_device` | Device name (e.g. `sda1`) for image storage; empty = internal |
| `clips_primary_device` | Device name for video clip storage; empty = internal |
| `clips_purge_threshold` | Disk usage % that triggers auto-purge of old clips (default `90`) |
| `notification_link_mode` | `local_ip` / `hostname` / `tailscale` — how the link in a notification points back to the device |
| `notification_hostname` | Hostname used in the link when `notification_link_mode` is `hostname` |
| `twilio_account_sid` | Twilio account SID for SMS notifications |
| `twilio_auth_token` | Twilio auth token |
| `twilio_from_number` | Twilio sending number (E.164 format, e.g. `+15551234567`) |
| `smtp_host` | SMTP server hostname for email notifications |
| `smtp_port` | SMTP server port |
| `smtp_username` | SMTP login username |
| `smtp_password` | SMTP login password |
| `smtp_from_address` | From address used in notification emails |
| `update_channel` | `releases` (stable tags) or `main` (latest commit) |
| `auto_update_enabled` | `1` / `0` — daily auto-update check at 3 AM |
| `timezone` | IANA timezone string (e.g. `America/Denver`) |
| `ntfy_server` | ntfy server base URL (default: `https://ntfy.sh`) |
| `ntfy_token` | Optional ntfy access token for private topics |
| `ntfy_enabled` | `1` / `0` — global ntfy on/off switch |
| `presence_enabled` | `1` / `0` — enable network presence detection |
| `presence_timeout` | Minutes without a ping before switching to away status (default `5`) |
| `presence_home_status` | Status to set when a watched device is detected (default `home`) |
| `presence_away_status` | Status to set when no watched device is detected (default `away`) |
| `zones_enabled` | `1` / `0` — global on/off for detection zones (default `0`); zone shapes themselves live in `camera_zones`, not here |
| `camera_health_alerts_enabled` | `1` / `0` — global on/off for camera-offline/back-online notifications (default `0`) |
| `continuous_recording_enabled` | `1` / `0` — global on/off for always-on recording (default `0`); segments themselves live in `continuous_segments`, not here |

User accounts and login sessions are **not** in `app_config` — they live in their own `users` and `sessions` tables in the same database. See [Users](Users). Detection zones live in their own `camera_zones` table (one row per polygon, normalized 0-1 points as JSON) — see [AI Detection → Detection Zones](AI-Detection#detection-zones). Continuous recording segments live in `continuous_segments` (one row per 5-minute file) — see [Storage → Continuous Recording](Storage#continuous-recording).

---

## Data Paths

| Path | Contents |
|---|---|
| `/opt/nomad-eye/data/db/nomadeye.db` | SQLite database (all settings and detection records) |
| `/opt/nomad-eye/data/images/` | Detection snapshot images |
| `/opt/nomad-eye/data/clips/` | Before/after video clips |

External storage mounts to `/mnt/nomadeye-<device>` and can be set as the primary location for images and clips via Settings → Storage.
