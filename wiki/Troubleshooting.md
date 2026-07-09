# Troubleshooting

---

## Motion is detected but no detection labels appear

The camera is triggering (motion threshold is passed) but the AI model is not labeling anything.

**Check confidence threshold.** If a category's confidence threshold (Settings → Detection → Confidence thresholds) is set too high, valid detections are silently dropped. Try lowering it to `0.35` and see if labels appear.

```bash
/opt/nomad-eye/backend/venv/bin/python -c "
import sqlite3
db = sqlite3.connect('/opt/nomad-eye/data/db/nomadeye.db')
print(db.execute(\"SELECT value FROM app_config WHERE key='confidence_people'\").fetchone())
"
```

**Check the active model.** If the model was recently changed and detection stopped working, re-select it from Settings → Detection → Detection Model — this re-triggers the download/load. Check logs for a failed download or load error:

```bash
journalctl -u nomad-eye-backend -n 100 --no-pager | grep -i "model\|onnx\|failed to load"
```

**ONNX shape mismatch.** An optional `.onnx` sibling of the active `.pt` model (e.g. `/opt/nomad-eye/backend/yolov8n.onnx` next to `yolov8n.pt`) is used automatically if present and its input shape matches — if you dropped in a mismatched `.onnx` file, remove it so the `.pt` model loads instead, then restart the service:

```bash
rm /opt/nomad-eye/backend/yolov8n.onnx
sudo systemctl restart nomad-eye-backend
```

Check logs for ONNX errors:

```bash
journalctl -u nomad-eye-backend -n 100 --no-pager | grep -i onnx
```

---

## Face detection not working

**Check that Faces is the only enabled category.** For best results use faces-only mode: disable people, vehicles, animals, and other in Settings → Detection → Confidence thresholds. This skips YOLO and runs face detection at higher resolution.

**Face detection requires motion to trigger.** Face detection only runs when the camera's motion detector fires. If the scene is completely static (no movement at all), face detection won't run. Slight movement (walking in, adjusting position) is enough to trigger it.

**Check that `face_recognition` is installed in the venv:**

```bash
/opt/nomad-eye/backend/venv/bin/python -c "import face_recognition; print('OK')"
```

If this fails, install it (takes 5–15 min to compile dlib):

```bash
sudo /opt/nomad-eye/backend/venv/bin/pip install face_recognition
```

**No faces stored in the library.** If no known faces are saved, all detected faces are labelled "Unknown" — they still show in the overlay and create events. Go to Settings → Faces to name them.

**Poor detection with glasses or IR/night vision.** The system applies CLAHE contrast enhancement before HOG face detection, which helps significantly. For best recognition accuracy, also add face samples captured with glasses and under IR conditions — the system saves unrecognized faces automatically as "Unknown" candidates that you can rename.

---

## Detection is very slow

**ARM device + heavy model.** The `yolov8m` model is too slow for real-time use on ARM64. Switch to `yolov8n` or `yolov8s` in Settings → Detection → Detection Model.

**Multiple cameras with detection enabled.** Each camera runs its own detection pipeline. On devices with 2–4 CPU cores, more than 2 cameras with full AI detection will saturate the CPU. Disable detection on secondary cameras or lower their resolution.

**Face recognition overhead.** Face recognition adds significant CPU time when persons are detected. It's a per-camera setting — disable it on cameras that don't need it from the Cameras page (face detection toggle on each camera card), or use the Sensitivity setting there to trade accuracy for speed.

Check CPU usage:

```bash
htop
```

---

## Camera not showing in the UI

**USB device not recognized.** Check if the device appears in the system:

```bash
ls /dev/video*
v4l2-ctl --list-devices
```

If no `/dev/video*` devices appear, the camera may not be UVC-compatible, or there is a USB hardware issue.

**USB bandwidth.** If the device appears in `/dev/video*` but OpenCV fails to open it, USB bandwidth contention is likely. Try:

- Disconnecting other USB devices
- Connecting to a different USB port (different controller)
- Lowering the camera resolution in settings

**Reload cameras.** After physically reconnecting a camera, use **Cameras → Reload** in the UI. A full service restart also works:

```bash
sudo systemctl restart nomad-eye-backend
```

**Check logs for OpenCV errors:**

```bash
journalctl -u nomad-eye-backend -n 50 --no-pager | grep -i opencv
```

---

## Service won't start

**Check the service status:**

```bash
sudo systemctl status nomad-eye-backend
```

**View full logs:**

```bash
journalctl -u nomad-eye-backend -n 200 --no-pager
```

**Common causes:**

| Symptom in logs | Cause | Fix |
|---|---|---|
| `No such file or directory: backend/venv` | venv not created | Run `python3 -m venv /opt/nomad-eye/backend/venv && /opt/nomad-eye/backend/venv/bin/pip install -r /opt/nomad-eye/backend/requirements.txt` |
| `ModuleNotFoundError` | pip install incomplete | Re-run pip install in the venv |
| `Address already in use` | Port 8080 is occupied (the backend binds `127.0.0.1:8080`; nginx is the separate process serving port 80) | `sudo lsof -i :8080` to find the conflicting process |
| `Permission denied` on data dir | Data directories owned by wrong user | `sudo chown -R nomadeye:nomadeye /opt/nomad-eye/data` |
| `.env` parse error | Malformed .env file | Check `/opt/nomad-eye/.env` for syntax errors |

**Restart the service after fixing:**

```bash
sudo systemctl restart nomad-eye-backend
```

---

## Can't connect remotely

**Tailscale not connected.** Check Tailscale status on the device:

```bash
tailscale status
```

If it shows `Stopped` or `Logged out`, reconnect from the UI: Settings → Network → Connect Account, or from the command line:

```bash
sudo tailscale up
```

**AP/hotspot mode active.** If the device is in hotspot mode (no network), Tailscale won't be connected. Connect the device to WiFi first via the captive portal (connect to the hotspot SSID and go to `http://10.42.0.1`).

**Firewall.** Check that port 80 is not blocked if you're accessing via a local network. Tailscale tunnels do not require open ports.

---

## HTTPS / certificate warnings

**Browser says the connection isn't private / certificate not trusted.** Expected the first time you visit `https://<device-ip>` — the device uses a self-signed certificate for LAN access, since it has no public domain for a real CA to verify. Click through the warning (in Chrome: Advanced → Proceed) once; browsers remember the exception afterward. See [Remote Access → HTTPS](Remote-Access#https) for a trusted-certificate alternative via Tailscale.

**"Enable HTTPS via Tailscale" fails.** Most common cause: HTTPS Certificates isn't enabled for your tailnet. Check the [Tailscale admin console](https://login.tailscale.com/admin/dns) → DNS tab → HTTPS Certificates. Also confirm Tailscale is actually connected (`tailscale status`) and MagicDNS is enabled — `tailscale cert` needs both.

**HTTPS doesn't work at all (connection refused on 443).** Check that nginx is actually listening on 443:

```bash
sudo ss -tlnp | grep :443
sudo nginx -t
```

If `nginx -t` fails, the TLS certificate files may be missing — regenerate them:

```bash
sudo bash /opt/nomad-eye/deploy/generate-self-signed-cert.sh
sudo systemctl restart nginx
```

---

## Logged out unexpectedly / can't log in after updating

**Everyone was signed out after an update.** Expected exactly once if you updated across the multi-user-accounts change — old browser sessions used a different auth mechanism that isn't recognized anymore. Just log in again with the same username/password as before; see [Users](Users#upgrading-from-an-older-version).

**Forgot your password and there's only one admin account.** There's no password-reset-by-email flow (no email server assumption for a self-hosted device). Reset it directly in the database:

```bash
sudo /opt/nomad-eye/backend/venv/bin/python -c "
import sqlite3, sys
sys.path.insert(0, '/opt/nomad-eye/backend')
from security import hash_password
db = sqlite3.connect('/opt/nomad-eye/data/db/nomadeye.db')
db.execute(\"UPDATE users SET password_hash=? WHERE username=?\", (hash_password('newpassword'), 'admin'))
db.execute(\"DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username='admin')\")
db.commit()
"
```

Replace `newpassword` and `admin` as needed, then log in with the new password.

**A demoted/deleted user is still logged in.** Sessions are only invalidated when an admin resets that user's password (or the user changes it themselves) — just changing their role doesn't kill their existing session, though the new role is enforced on their very next request regardless.

---

## Update fails

**git credentials / permission error.** The service runs as the `nomadeye` user. If `/opt/nomad-eye` is owned by `root`, git pull will fail.

```bash
sudo chown -R nomadeye:nomadeye /opt/nomad-eye
```

**npm not installed.** If the frontend build step fails, verify npm is available:

```bash
npm --version
```

If not installed:

```bash
sudo apt install -y nodejs npm
```

**Disk full.** npm install can fail silently if disk space runs out. Check:

```bash
df -h /opt/nomad-eye
```

Purge old detections (**Storage → Purge**) to free space, then retry the update.

**Manual update fallback:**

```bash
cd /opt/nomad-eye
sudo -u nomadeye git pull
sudo -u nomadeye bash -c 'cd frontend && npm install && npm run build'
sudo systemctl restart nomad-eye-backend
```
