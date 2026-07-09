# Installation

---

## Prerequisites

**System packages** (installed automatically by deploy.sh):

```
python3  python3-pip  python3-venv  nodejs  npm  git
libopencv-dev  python3-opencv  network-manager  curl  nginx  ffmpeg  arp-scan
```

`ffmpeg` is used to convert recorded clips to H.264 so they play in all browsers.
`nginx` reverse-proxies port 80 to the backend. `arp-scan` is used for presence detection.

Your device must be running Debian or Ubuntu Linux. The deploy script uses `apt`.

**Minimum hardware:**

| Requirement | Minimum |
|---|---|
| Architecture | ARM64 or x86-64 |
| RAM | 2 GB |
| Storage | 16 GB free |
| Camera | UVC-compatible USB camera |

---

## One-Liner Install

```bash
curl -fsSL https://raw.githubusercontent.com/asniper/nomad-eye/main/deploy/deploy.sh | sudo bash
```

This handles everything: creating the service user, installing system deps, cloning the
repo, installing Python/Node dependencies, downloading the default AI model, building the
frontend, creating the data directories, configuring sudoers, installing and starting both
systemd services (backend + network/hotspot-fallback), installing the NetworkManager
captive-portal dispatcher script, generating a self-signed TLS certificate, and configuring
nginx for both HTTP and HTTPS.

---

## Manual Install

Follow these steps if you want to understand or customize the install process. Everything
under `/opt/nomad-eye` runs as the `nomadeye` user, so create it first.

### 1. Create the service user

```bash
sudo useradd -m -s /bin/bash \
    -G video,audio,dialout,input,render,netdev,bluetooth,gpiod,adm \
    nomadeye
```

The `video` group is required for camera device access (`/dev/video*`).

### 2. Install system dependencies

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv nodejs npm git \
    libopencv-dev python3-opencv network-manager curl nginx ffmpeg arp-scan openssl
```

### 3. Clone the repository

```bash
sudo git clone https://github.com/asniper/nomad-eye /opt/nomad-eye
sudo chown -R nomadeye:nomadeye /opt/nomad-eye
```

If the directory already exists (updating), run this instead:

```bash
cd /opt/nomad-eye && sudo -u nomadeye git pull
```

### 4. Set up the Python virtual environment

```bash
cd /opt/nomad-eye
sudo -u nomadeye python3 -m venv backend/venv
sudo -u nomadeye backend/venv/bin/pip install --upgrade pip
sudo -u nomadeye backend/venv/bin/pip install -r backend/requirements.txt
```

### 5. Pre-download the default AI model

This lets ultralytics fetch `yolov8n.pt` once now, so the device doesn't need internet
access the first time detection runs:

```bash
cd /opt/nomad-eye/backend
sudo -u nomadeye venv/bin/python3 -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"
```

### 6. Build the frontend

```bash
cd /opt/nomad-eye/frontend
sudo -u nomadeye npm install
sudo -u nomadeye npm run build
```

### 7. Create data directories

```bash
sudo -u nomadeye mkdir -p /opt/nomad-eye/data/images \
         /opt/nomad-eye/data/clips \
         /opt/nomad-eye/data/db
```

### 8. Configure the sudo helper

See [Sudo Helper Setup](#sudo-helper-setup) below — required before starting the services,
since the storage/network/system-control features depend on it.

### 9. Install and start the systemd services

```bash
sudo cp /opt/nomad-eye/deploy/nomad-eye-backend.service /etc/systemd/system/
sudo cp /opt/nomad-eye/deploy/nomad-eye-network.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable nomad-eye-backend nomad-eye-network
sudo systemctl restart nomad-eye-backend nomad-eye-network
```

`nomad-eye-network` runs the WiFi auto-connect/hotspot-fallback loop; `nomad-eye-backend`
is the FastAPI app (bound to `127.0.0.1:8080`, not reachable directly — see step 11).

### 10. Install the captive-portal dispatcher script

Needed so a device connecting to the setup hotspot gets redirected to the setup page:

```bash
sudo cp /opt/nomad-eye/deploy/99-nomadeye-captive /etc/NetworkManager/dispatcher.d/99-nomadeye-captive
sudo chmod +x /etc/NetworkManager/dispatcher.d/99-nomadeye-captive
```

### 11. Generate a self-signed TLS certificate

Needed for the HTTPS listener nginx configures in the next step:

```bash
sudo bash /opt/nomad-eye/deploy/generate-self-signed-cert.sh
```

### 12. Configure nginx

The backend only listens on `127.0.0.1:8080` — nginx is what exposes the UI on port 80 (HTTP) and 443 (HTTPS, self-signed by default — see [Remote Access → HTTPS](Remote-Access#https) for upgrading to a trusted certificate):

```bash
sudo cp /opt/nomad-eye/deploy/nginx-locations.conf /etc/nginx/nomadeye-locations.conf
sudo cp /opt/nomad-eye/deploy/nginx.conf /etc/nginx/sites-available/nomad-eye
sudo ln -sf /etc/nginx/sites-available/nomad-eye /etc/nginx/sites-enabled/nomad-eye
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl enable nginx && sudo systemctl restart nginx
```

---

## Sudo Helper Setup

Storage and network management features require `nomadeye` to run a privileged helper
script. Add these lines to `/etc/sudoers.d/nomadeye` (mode 0440):

```
nomadeye ALL=(ALL) NOPASSWD: /opt/nomad-eye/storage-helper.sh
nomadeye ALL=(ALL) NOPASSWD: /usr/bin/timedatectl
```

The actual script lives at `deploy/storage-helper.sh`; the backend creates a symlink at
`/opt/nomad-eye/storage-helper.sh` automatically on first start (so the sudoers path above
always resolves), no manual copy needed.

The helper script handles: service restart, device reboot, mounting/unmounting storage
devices, formatting drives as ext4, and ARP scans for presence detection. It does not grant
general sudo access.

---

## First Boot

Once the service is running, find your device's IP address:

```bash
hostname -I
```

Open a browser and go to:

```
http://<device-ip>
```

The web UI should load (served by nginx on port 80). HTTPS is also available at `https://<device-ip>` (port 443) — browsers will show a one-time trust warning since it's a self-signed certificate; see [Remote Access → HTTPS](Remote-Access#https) for upgrading to a trusted one. Log in with the default credentials:

| Field | Default |
|---|---|
| Username | `admin` |
| Password | `nomadeye` |

---

## Changing the Default Password

> **Do this immediately after first login.**

1. Click **Settings** in the left sidebar
2. Click **Admin Password**
3. Enter your current password, then your new password twice
4. Click **Save**

You can also set credentials before first boot by creating a `.env` file at `/opt/nomad-eye/.env`:

```env
ADMIN_USERNAME=yourname
ADMIN_PASSWORD=yoursecurepassword
```

Then restart the service:

```bash
sudo systemctl restart nomad-eye-backend
```
