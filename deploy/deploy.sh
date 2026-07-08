#!/bin/bash
set -e

echo "=== Nomad Eye Deployment ==="

# Update system
sudo apt update && sudo apt upgrade -y

# Install system dependencies
sudo apt install -y python3 python3-pip python3-venv nodejs npm git \
    libopencv-dev python3-opencv network-manager curl nginx ffmpeg arp-scan

# Create service user if it does not exist
if ! id -u nomadeye &>/dev/null; then
    echo "Creating nomadeye user..."
    sudo useradd -m -s /bin/bash \
        -G video,audio,dialout,input,render,netdev,bluetooth,gpiod,adm \
        nomadeye
fi

REPO_DIR="/opt/nomad-eye"

# Clone or pull repo (as nomadeye)
if [ -d "$REPO_DIR/.git" ]; then
    echo "Updating existing installation..."
    sudo -u nomadeye git -C "$REPO_DIR" pull
else
    echo "Cloning repository..."
    sudo git clone https://github.com/asniper/nomad-eye.git "$REPO_DIR"
    sudo chown -R nomadeye:nomadeye "$REPO_DIR"
fi

# Ensure ownership
sudo chown -R nomadeye:nomadeye "$REPO_DIR"

cd "$REPO_DIR"

# Python virtual environment (run as nomadeye)
sudo -u nomadeye python3 -m venv backend/venv
sudo -u nomadeye bash -c "
    source '$REPO_DIR/backend/venv/bin/activate' &&
    pip install --upgrade pip &&
    pip install -r '$REPO_DIR/backend/requirements.txt'
"

# Download YOLOv8n ONNX model
MODEL_DIR="$REPO_DIR/models/yolo"
sudo -u nomadeye mkdir -p "$MODEL_DIR"
if [ ! -f "$MODEL_DIR/yolov8n.onnx" ]; then
    echo "Downloading YOLOv8n model..."
    sudo -u nomadeye curl -L \
        "https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx" \
        -o "$MODEL_DIR/yolov8n.onnx"
fi

# Build frontend
cd "$REPO_DIR/frontend"
sudo -u nomadeye npm install
sudo -u nomadeye npm run build

# Create data directories
sudo -u nomadeye mkdir -p "$REPO_DIR/data/images" "$REPO_DIR/data/clips" "$REPO_DIR/data/db"

# Configure sudoers for nomadeye (privileged helpers only)
SUDOERS_FILE="/etc/sudoers.d/nomadeye"
cat <<'EOF' | sudo tee "$SUDOERS_FILE" > /dev/null
nomadeye ALL=(ALL) NOPASSWD: /opt/nomad-eye/storage-helper.sh
nomadeye ALL=(ALL) NOPASSWD: /usr/bin/timedatectl
EOF
sudo chmod 440 "$SUDOERS_FILE"

# Install systemd services
sudo cp "$REPO_DIR/deploy/nomad-eye-backend.service" /etc/systemd/system/
sudo cp "$REPO_DIR/deploy/nomad-eye-network.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable nomad-eye-backend nomad-eye-network
sudo systemctl restart nomad-eye-backend nomad-eye-network

# Install NetworkManager dispatcher script for captive-portal redirect during hotspot mode
sudo cp "$REPO_DIR/deploy/99-nomadeye-captive" /etc/NetworkManager/dispatcher.d/99-nomadeye-captive
sudo chmod +x /etc/NetworkManager/dispatcher.d/99-nomadeye-captive

# Grant nomadeye operator access to Tailscale (no sudo needed for tailscale commands)
if command -v tailscale &>/dev/null; then
    sudo tailscale set --operator=nomadeye
fi

# Configure nginx as reverse proxy
sudo cp "$REPO_DIR/deploy/nginx.conf" /etc/nginx/sites-available/nomad-eye
sudo ln -sf /etc/nginx/sites-available/nomad-eye /etc/nginx/sites-enabled/nomad-eye
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl enable nginx && sudo systemctl restart nginx

echo ""
echo "=== Deployment complete ==="
echo "Access the web app at: http://$(hostname -I | awk '{print $1}')"
echo "Default login: admin / nomadeye"
echo "IMPORTANT: Change your password in Settings after first login."
