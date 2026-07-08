#!/bin/bash
# Sets the device hostname to "nomadeye" and enables mDNS so the device
# is reachable as nomadeye.local on the local network without knowing its IP.
set -e

NEW_HOSTNAME="nomadeye"

echo "Setting hostname to $NEW_HOSTNAME..."
hostnamectl set-hostname "$NEW_HOSTNAME"

# Update /etc/hosts so localhost resolves correctly with the new name
if grep -q "127.0.1.1" /etc/hosts; then
    sed -i "s/127.0.1.1.*/127.0.1.1\t$NEW_HOSTNAME/" /etc/hosts
else
    echo "127.0.1.1	$NEW_HOSTNAME" >> /etc/hosts
fi

# Install and enable avahi-daemon (mDNS / .local resolution)
apt-get install -y avahi-daemon avahi-utils

# Minimal avahi config: publish the hostname
cat > /etc/avahi/avahi-daemon.conf << 'EOF'
[server]
host-name=nomadeye
domain-name=local
use-ipv4=yes
use-ipv6=no
allow-interfaces=wlan0
deny-interfaces=docker0

[publish]
publish-addresses=yes
publish-hinfo=no
publish-workstation=no
publish-domain=yes
EOF

systemctl enable avahi-daemon
systemctl restart avahi-daemon

echo ""
echo "Done. Device is now reachable at:"
echo "  http://nomadeye.local"
echo "  (may take a few seconds to propagate on the network)"
