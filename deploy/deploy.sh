#!/bin/bash
set -e

echo "=== Nomad Eye Deployment ==="

# Update system
sudo apt update && sudo apt upgrade -y

# Install system dependencies
sudo apt install -y python3 python3-pip python3-venv nodejs npm git \
    libopencv-dev python3-opencv network-manager curl nginx ffmpeg arp-scan

# Clone or pull repo
REPO_DIR="/opt/nomad-eye"
if [ -d "$REPO_DIR/.git" ]; then
    echo "Updating existing installation..."
    cd $REPO_DIR && git pull
else
    echo "Cloning repository..."
    sudo git clone https://github.com/asniper/nomad-eye.git $REPO_DIR
    sudo chown -R $USER:$USER $REPO_DIR
fi

cd $REPO_DIR

# Python virtual environment
python3 -m venv backend/venv
source backend/venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt

# Download YOLOv8n ONNX model
MODEL_DIR="$REPO_DIR/models/yolo"
mkdir -p $MODEL_DIR
if [ ! -f "$MODEL_DIR/yolov8n.onnx" ]; then
    echo "Downloading YOLOv8n model..."
    curl -L "https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx" \
        -o "$MODEL_DIR/yolov8n.onnx"
fi

# Build frontend
cd $REPO_DIR/frontend
npm install
npm run build

# Create data directories
mkdir -p $REPO_DIR/data/images $REPO_DIR/data/clips $REPO_DIR/data/db

# Install systemd services
sudo cp $REPO_DIR/deploy/nomad-eye-backend.service /etc/systemd/system/
sudo cp $REPO_DIR/deploy/nomad-eye-network.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable nomad-eye-backend nomad-eye-network
sudo systemctl restart nomad-eye-backend nomad-eye-network

# Grant service user permission to control Tailscale without root
if command -v tailscale &>/dev/null; then
    sudo tailscale set --operator=$USER
fi

# Configure nginx as reverse proxy
sudo cp $REPO_DIR/deploy/nginx.conf /etc/nginx/sites-available/nomad-eye
sudo ln -sf /etc/nginx/sites-available/nomad-eye /etc/nginx/sites-enabled/nomad-eye
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl enable nginx && sudo systemctl restart nginx

echo ""
echo "=== Deployment complete ==="
echo "Access the web app at: http://$(hostname -I | awk '{print $1}')"
echo "Default login: admin / nomadeye"
echo "IMPORTANT: Change your password in Settings after first login."
