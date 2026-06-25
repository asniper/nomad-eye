#!/bin/bash
# Privileged storage/system helper for Nomad Eye.
# Run via: sudo /opt/nomad-eye/storage-helper.sh <action> [device]
set -e

ACTION="$1"
DEVICE="$2"

# Restart action needs no device validation
if [ "$ACTION" = "restart" ]; then
    systemctl restart nomad-eye-backend.service
    exit 0
fi

if [ "$ACTION" = "reboot" ]; then
    /sbin/reboot
    exit 0
fi

if [ "$ACTION" = "tailscale-set-operator" ]; then
    tailscale set --operator=arduino
    exit 0
fi

if [ "$ACTION" = "arp-scan" ]; then
    IFACE=$(ip route get 8.8.8.8 2>/dev/null | grep -oP 'dev \K\S+' | head -1)
    if [ -n "$IFACE" ]; then
        arp-scan -I "$IFACE" --localnet 2>/dev/null || true
    else
        arp-scan --localnet 2>/dev/null || true
    fi
    exit 0
fi

# All other actions require a valid device name
if ! echo "$DEVICE" | grep -qE '^[a-z0-9]{1,32}$'; then
    echo "Invalid device name: $DEVICE" >&2
    exit 1
fi

DEVPATH="/dev/${DEVICE}"
MP="/mnt/nomadeye-${DEVICE}"

if [ "$ACTION" != "format_ext4" ] && [ ! -b "$DEVPATH" ]; then
    echo "Device not found: $DEVPATH" >&2
    exit 1
fi

case "$ACTION" in
  mount)
    mkdir -p "$MP"
    if mountpoint -q "$MP" 2>/dev/null; then
        chown arduino:arduino "$MP" 2>/dev/null || true
        echo "$MP"
        exit 0
    fi
    mount "$DEVPATH" "$MP"
    chown arduino:arduino "$MP"
    mkdir -p "$MP/nomadeye/images" "$MP/nomadeye/clips"
    chown -R arduino:arduino "$MP/nomadeye"
    echo "$MP"
    ;;

  unmount)
    if mountpoint -q "$MP" 2>/dev/null; then
        sync
        umount "$MP"
    fi
    rmdir "$MP" 2>/dev/null || true
    ;;

  format_ext4)
    if [ ! -b "$DEVPATH" ]; then
        echo "Device not found: $DEVPATH" >&2
        exit 1
    fi
    umount "$DEVPATH" 2>/dev/null || true
    umount "$MP" 2>/dev/null || true
    mkfs.ext4 -F -L "NomadEye" "$DEVPATH"
    ;;

  *)
    echo "Unknown action: $ACTION" >&2
    exit 1
    ;;
esac
