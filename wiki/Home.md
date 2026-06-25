# Nomad Eye Wiki

Self-hosted AI security camera system. Runs entirely on-device — no cloud, no subscriptions, no data leaving your network.

---

## What It Does

Nomad Eye turns any Linux device with a USB camera into a local AI security system. It detects people, vehicles, animals, and custom-defined objects using YOLO models running on-device. When something is detected, it saves a snapshot and a short video clip (with pre-event footage), and can send you an SMS or email based on configurable rules.

The full system — backend, frontend, and AI — runs as a single systemd service. The web UI handles everything: cameras, detection settings, notifications, WiFi, storage, and updates.

---

## Feature Summary

- YOLO AI detection (people, vehicles, animals, custom open-vocab classes)
- Face recognition with a local face library
- Live MJPEG streams with motion and detection overlay
- Detection events saved as images + video clips (5s before/after)
- SMS notifications via Twilio; email via SMTP
- Rule-based notification filtering (category, time window, frequency)
- WiFi management from the UI; captive portal hotspot for first-time setup
- Tailscale remote access with in-app setup
- USB/SD card external storage management
- OTA updates from GitHub (stable releases or main branch)
- Change admin password from the UI

---

## Quick Navigation

| Page | What's in it |
|---|---|
| [Installation](Installation) | Prerequisites, one-liner install, manual install, first boot |
| [Configuration](Configuration) | .env variables, database config keys, settings layering |
| [Camera Setup](Camera-Setup) | Connecting USB cameras, USB bandwidth, enabling/disabling |
| [AI Detection](AI-Detection) | All 6 models, confidence thresholds, open-vocab classes |
| [Face Recognition](Face-Recognition) | Enabling, capturing faces, building a library, merging |
| [Notifications](Notifications) | Twilio SMS, SMTP email, contacts, rules |
| [Remote Access](Remote-Access) | Tailscale install, connect, node sharing |
| [Storage](Storage) | Internal vs external, mounting, formatting, purging |
| [OTA Updates](OTA-Updates) | Update channels, manual check, auto-update |
| [Troubleshooting](Troubleshooting) | Common issues and fixes |

---

## System Info

| Item | Detail |
|---|---|
| Repo | github.com/asniper/nomad-eye |
| Install path | `/opt/nomad-eye/` |
| Service name | `nomad-eye-backend.service` |
| Service user | `nomadeye` |
| Backend port | `80` (standard HTTP) |
| Default credentials | `admin` / `nomadeye` |
| License | MIT |
