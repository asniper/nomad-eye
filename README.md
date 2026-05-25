# Nomad Eye

Self-hosted AI security camera system — runs entirely on-device, no cloud required.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- **AI detection** — YOLO-based detection for people, vehicles, animals, and custom classes
- **Face recognition** — identify known faces and build a local face library from captures
- **Live MJPEG streams** — real-time video with motion and detection overlay
- **Detection events** — saves image snapshots and 5s before/after video clips locally
- **Notifications** — SMS via Twilio, email via SMTP; rule-based by category, time window, and frequency
- **WiFi management** — scan, connect, and forget networks from the UI; captive portal hotspot for initial setup
- **Tailscale remote access** — in-app setup flow with node sharing guide
- **External storage** — mount, format, and set primary USB drives or SD cards
- **OTA updates** — check and install from GitHub; optional daily auto-update at 3 AM

---

## Hardware Requirements

| Requirement | Minimum |
|---|---|
| Architecture | ARM64 or x86-64 |
| RAM | 2 GB |
| Storage | 16 GB |
| OS | Debian/Ubuntu Linux |
| Camera | UVC-compatible USB camera |

Tested on the Arduino Uno Q (ARM64, Debian). x86-64 unlocks additional AI models (OWLv2, Grounding DINO, MegaDetector).

---

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/asniper/nomad-eye/main/deploy/deploy.sh | sudo bash
```

Or clone and run manually:

```bash
git clone https://github.com/asniper/nomad-eye /opt/nomad-eye
cd /opt/nomad-eye
sudo bash deploy/deploy.sh
```

See the [Installation wiki page](../../wiki/Installation) for manual step-by-step instructions and the sudo helper setup.

---

## First Login

Once the service is running, open `http://<device-ip>` in a browser.

| Field | Default |
|---|---|
| Username | `admin` |
| Password | `nomadeye` |

> **Change the default password immediately.** Go to Settings → Admin Password after first login.

---

## Configuration

Create a `.env` file in `/opt/nomad-eye/` to override defaults.

| Variable | Default | Description |
|---|---|---|
| `ADMIN_USERNAME` | `admin` | Admin login username |
| `ADMIN_PASSWORD` | `nomadeye` | Admin login password |
| `SECRET_KEY` | *(generated)* | JWT signing key |
| `DB_PATH` | `data/db/app.db` | SQLite database path |
| `IMAGES_DIR` | `data/images` | Detection snapshot storage |
| `CLIPS_DIR` | `data/clips` | Video clip storage |
| `DETECTION_CONFIDENCE` | `0.5` | Minimum detection confidence (0–1) |
| `MOTION_THRESHOLD` | `500` | Pixel-change threshold to trigger motion |
| `CLIP_SECONDS_BEFORE` | `5` | Seconds of pre-event clip to save |
| `CLIP_SECONDS_AFTER` | `5` | Seconds of post-event clip to save |

For all configuration options and the app_config database keys, see the [Configuration wiki page](../../wiki/Configuration).

---

## Documentation

Full documentation lives in the [project wiki](../../wiki):

| Page | Description |
|---|---|
| [Installation](../../wiki/Installation) | Full install guide, sudo helper setup, first boot |
| [Configuration](../../wiki/Configuration) | .env variables, DB config keys |
| [Camera Setup](../../wiki/Camera-Setup) | USB cameras, bandwidth, enabling/disabling |
| [AI Detection](../../wiki/AI-Detection) | Models, thresholds, open-vocab classes |
| [Face Recognition](../../wiki/Face-Recognition) | Face library, merging, performance |
| [Notifications](../../wiki/Notifications) | Twilio SMS, SMTP email, rules |
| [Remote Access](../../wiki/Remote-Access) | Tailscale setup and node sharing |
| [Storage](../../wiki/Storage) | USB drives, formatting, purging |
| [OTA Updates](../../wiki/OTA-Updates) | Update channels, auto-update |
| [Troubleshooting](../../wiki/Troubleshooting) | Common issues and fixes |

---

## Contributing

Pull requests are welcome. For significant changes, open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Open a pull request

---

## License

MIT
