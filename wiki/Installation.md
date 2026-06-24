# Installation

---

## Prerequisites

**System packages** (installed automatically by deploy.sh):

```
python3  python3-venv  nodejs  npm  git
libopencv-dev  python3-opencv  network-manager  curl  ffmpeg
```

`ffmpeg` is used to convert recorded clips to H.264 so they play in all browsers.

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

This handles everything: installing system deps, cloning the repo, building the frontend, downloading the default AI model, creating the data directories, installing and starting the systemd service.

---

## Manual Install

Follow these steps if you want to understand or customize the install process.

### 1. Install system dependencies

```bash
sudo apt update
sudo apt install -y python3 python3-venv nodejs npm git \
    libopencv-dev python3-opencv network-manager curl ffmpeg
```

### 2. Clone the repository

```bash
sudo git clone https://github.com/asniper/nomad-eye /opt/nomad-eye
```

If the directory already exists (updating), run `git pull` instead:

```bash
cd /opt/nomad-eye && sudo git pull
```

### 3. Set up the Python virtual environment

```bash
cd /opt/nomad-eye
python3 -m venv backend/venv
backend/venv/bin/pip install -r backend/requirements.txt
```

### 4. Download the default AI model

```bash
mkdir -p /opt/nomad-eye/models
curl -L https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx \
    -o /opt/nomad-eye/models/yolov8n.onnx
```

### 5. Build the frontend

```bash
cd /opt/nomad-eye/frontend
npm install
npm run build
```

### 6. Create data directories

```bash
mkdir -p /opt/nomad-eye/data/images \
         /opt/nomad-eye/data/clips \
         /opt/nomad-eye/data/db
```

### 7. Install the systemd service

```bash
sudo cp /opt/nomad-eye/deploy/nomad-eye-backend.service \
        /etc/systemd/system/nomad-eye-backend.service
sudo systemctl daemon-reload
sudo systemctl enable nomad-eye-backend
sudo systemctl start nomad-eye-backend
```

---

## Sudo Helper Setup

The storage and network management features require the `arduino` service user to run a specific helper script with elevated privileges. Add the following line to `/etc/sudoers` (use `visudo` to edit safely):

```
arduino ALL=(ALL) NOPASSWD: /opt/nomad-eye/deploy/storage-helper.sh
```

The helper script handles: service restart, device reboot, mounting/unmounting storage devices, and formatting drives as ext4. It does not grant general sudo access.

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

The web UI should load. Log in with the default credentials:

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
