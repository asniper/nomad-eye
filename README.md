# Nomad Eye

Self-hosted AI security camera system — runs entirely on-device, no cloud required.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- **AI detection** — YOLO-based detection for people, vehicles, animals, and custom classes
- **Face recognition** — identify known faces and build a local face library from captures
- **Live MJPEG streams** — real-time video with motion and detection overlay
- **Detection events** — saves image snapshots and H.264 video clips (pre-roll + post-roll) locally; watch clips inline or download from the event detail page
- **Notifications** — push via ntfy (free, no account needed), SMS via Twilio or carrier email gateway, email via SMTP; rule-based by category, time window, and frequency
- **Presence detection** — automatically switch device status based on whether your phone is on the local network (ARP-based, no app required)
- **WiFi management** — scan, connect, and forget networks from the UI; captive portal hotspot for initial setup
- **Tailscale remote access** — in-app setup flow with node sharing guide; one-click upgrade to a real HTTPS certificate
- **HTTPS** — self-signed by default on port 443, upgradeable to a trusted Let's Encrypt-backed certificate via Tailscale
- **External storage** — mount, format, and set primary USB drives or SD cards
- **OTA updates** — check and install from GitHub; optional daily auto-update at 3 AM
- **Multi-user accounts** — admin/operator/viewer roles with full user management

---

## Hardware Requirements

| Requirement | Minimum |
|---|---|
| Architecture | ARM64 or x86-64 |
| RAM | 2 GB |
| Storage | 16 GB |
| OS | Debian/Ubuntu Linux |
| Camera | UVC-compatible USB camera |

Tested on the Arduino Uno Q (ARM64, Debian). The UI recommends x86-64 for a few additional AI models (OWLv2, Grounding DINO, MegaDetector) since they're impractically slow on ARM CPUs — see [AI Detection](../../wiki/AI-Detection) for details.

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


## Documentation

Full documentation lives in the [project wiki](../../wiki):

| Page | Description |
|---|---|
| [Installation](../../wiki/Installation) | Full install guide, sudo helper setup, first boot |
| [Configuration](../../wiki/Configuration) | Settings, DB config keys, storage paths |
| [Camera Setup](../../wiki/Camera-Setup) | USB cameras, bandwidth, enabling/disabling |
| [AI Detection](../../wiki/AI-Detection) | Models, thresholds, open-vocab classes |
| [Face Recognition](../../wiki/Face-Recognition) | Face library, merging, performance |
| [Notifications](../../wiki/Notifications) | ntfy, SMS, email, rules |
| [Presence Detection](../../wiki/Presence) | Auto status via network device detection |
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
