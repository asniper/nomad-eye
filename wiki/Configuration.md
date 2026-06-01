# Configuration

All Nomad Eye settings are managed through the web UI and stored as key-value pairs in the SQLite database (`data/db/nomadeye.db`). There is no configuration file to edit — install the app, log in, and configure everything from Settings.

---

## Web UI Settings

| Location | What you can configure |
|---|---|
| Settings → General | AI model, detection confidence, motion threshold, categories, clip length, timezone |
| Settings → Faces | Face recognition enable/disable, face library management |
| Settings → Network | WiFi networks, hotspot mode, Tailscale, external access URL |
| Settings → Storage | Primary storage location, external drive management, purge old data |
| Settings → System | Timezone, admin password, OTA update channel and auto-update |
| Settings → Notifications | Twilio SMS, SMTP email, contacts, notification rules |

---

## Database Keys

Settings are stored in the `app_config` table. You can inspect them directly if needed:

```bash
sqlite3 /opt/nomad-eye/data/db/nomadeye.db "SELECT key, value FROM app_config;"
```

### Key Reference

| Key | Description |
|---|---|
| `admin_password` | Hashed admin password (set via Settings → System → Change Password) |
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
| `yoloworld_classes` | Comma-separated class names for YOLOWorld open-vocab detection |
| `external_url` | Base URL used in notification links (set to Tailscale IP for remote access) |
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

---

## Data Paths

| Path | Contents |
|---|---|
| `/opt/nomad-eye/data/db/nomadeye.db` | SQLite database (all settings and detection records) |
| `/opt/nomad-eye/data/images/` | Detection snapshot images |
| `/opt/nomad-eye/data/clips/` | Before/after video clips |

External storage mounts to `/mnt/nomadeye-<device>` and can be set as the primary location for images and clips via Settings → Storage.
