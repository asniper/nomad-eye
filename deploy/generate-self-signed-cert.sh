#!/bin/bash
# Generates a long-lived self-signed TLS certificate for LAN HTTPS access.
# Idempotent — skips if a certificate already exists. Run as root (deploy.sh
# runs as root throughout, per the top-level `sudo bash` install).
set -e

CERT_DIR="/etc/nginx/ssl"
CERT_FILE="$CERT_DIR/nomadeye.crt"
KEY_FILE="$CERT_DIR/nomadeye.key"

if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    echo "TLS certificate already exists at $CERT_FILE, skipping generation."
    exit 0
fi

mkdir -p "$CERT_DIR"

LAN_IP=$(hostname -I | awk '{print $1}')
SAN="DNS:nomadeye.local,DNS:localhost,IP:127.0.0.1"
if [ -n "$LAN_IP" ]; then
    SAN="${SAN},IP:${LAN_IP}"
fi

echo "Generating self-signed TLS certificate (SAN: $SAN)..."
openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "$KEY_FILE" -out "$CERT_FILE" \
    -subj "/CN=nomadeye.local" \
    -addext "subjectAltName=$SAN"

# nginx's worker processes (not just the root master) need read access to the
# key to perform TLS handshakes — www-data is the standard Debian/Ubuntu nginx user.
chown root:www-data "$KEY_FILE"
chmod 640 "$KEY_FILE"
chmod 644 "$CERT_FILE"

echo "TLS certificate generated at $CERT_FILE"
echo "Browsers will show a one-time trust warning for this cert — that's expected for a self-signed local device."
