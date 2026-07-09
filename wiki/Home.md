# Nomad Eye Wiki

Self-hosted AI security camera system. Runs entirely on-device — no cloud, no subscriptions, no data leaving your network.

---

## What It Does

Nomad Eye turns any Linux device with a USB camera into a local AI security system. It detects people, vehicles, animals, and custom-defined objects using YOLO models running on-device. When something is detected, it saves a snapshot and a short video clip (with pre-event footage), and can send you an SMS or email based on configurable rules.

The full system — backend, frontend, and AI — runs as a single systemd service. The web UI handles everything: cameras, detection settings, notifications, WiFi, storage, and updates.

---

## Feature Summary

- YOLO AI detection (people, vehicles, animals, custom open-vocab classes)
- Detection zones — per-camera include/exclude regions, off by default
- Face recognition with a local face library
- Live MJPEG streams with motion and detection overlay
- Detection events saved as images + optional video clips (5s pre-roll / 10s post-roll by default)
- SMS notifications via Twilio; email via SMTP
- Rule-based notification filtering (category, time window, frequency)
- Camera health alerts — notified if a camera goes offline or recovers, off by default
- WiFi management from the UI; captive portal hotspot for first-time setup
- Tailscale remote access with in-app setup
- USB/SD card external storage management
- OTA updates from GitHub (stable releases or main branch)
- Multi-user accounts with roles (admin / operator / viewer)

---

## Quick Navigation

| Page | What's in it |
|---|---|
| [Installation](Installation) | Prerequisites, one-liner install, manual install, first boot |
| [Configuration](Configuration) | .env variables, database config keys, settings layering |
| [Camera Setup](Camera-Setup) | Connecting USB cameras, USB bandwidth, enabling/disabling |
| [AI Detection](AI-Detection) | All 6 models, confidence thresholds, open-vocab classes |
| [Face Recognition](Face-Recognition) | Enabling, the auto-built face library, assigning names |
| [Notifications](Notifications) | ntfy, Twilio SMS, SMTP email, contacts, rules |
| [Users](Users) | Roles, managing accounts, changing your password |
| [Remote Access](Remote-Access) | Tailscale setup, connect, node sharing |
| [Storage](Storage) | Internal vs external, mounting, formatting, purging |
| [OTA Updates](OTA-Updates) | Update channels, manual check, auto-update |
| [Troubleshooting](Troubleshooting) | Common issues and fixes |

---

## System Info

| Item | Detail |
|---|---|
| Repo | github.com/asniper/nomad-eye |
| Install path | `/opt/nomad-eye/` |
| Service names | `nomad-eye-backend.service`, `nomad-eye-network.service` |
| Service user | `nomadeye` |
| Backend port | `8080` (behind nginx, which serves the UI on standard port `80`) |
| Default credentials | `admin` / `nomadeye` |
| License | MIT |
