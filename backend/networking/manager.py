import subprocess
import sqlite3
import asyncio
from datetime import datetime
from config.settings import get_settings

cfg = get_settings()


def nmcli(*args) -> str:
    result = subprocess.run(["/usr/bin/nmcli"] + list(args), capture_output=True, text=True)
    return result.stdout.strip()


def _terse_split(line: str, maxsplit: int = -1) -> list:
    """Split nmcli terse output on unescaped ':' characters."""
    parts = []
    current = []
    i = 0
    splits = 0
    while i < len(line):
        if line[i] == '\\' and i + 1 < len(line):
            current.append(line[i + 1])
            i += 2
        elif line[i] == ':' and (maxsplit < 0 or splits < maxsplit):
            parts.append(''.join(current))
            current = []
            splits += 1
            i += 1
        else:
            current.append(line[i])
            i += 1
    parts.append(''.join(current))
    return parts


def get_known_networks() -> list:
    """Read saved WiFi profiles directly from NetworkManager."""
    raw = nmcli("-t", "-f", "NAME,TYPE", "connection", "show")
    networks = []
    seen = set()
    for line in raw.splitlines():
        parts = _terse_split(line, maxsplit=1)
        if len(parts) == 2 and "wireless" in parts[1].lower():
            ssid = parts[0]
            if ssid and ssid not in seen and ssid != "NomadEye-AP":
                seen.add(ssid)
                networks.append({"ssid": ssid})
    return networks


def save_network(ssid: str, password: str):
    """Persist a network to the local DB (used for auto-connect logic)."""
    db = sqlite3.connect(cfg.db_path)
    db.execute(
        "INSERT INTO networks (ssid, password, last_connected) VALUES (?, ?, ?) "
        "ON CONFLICT(ssid) DO UPDATE SET password=excluded.password, last_connected=excluded.last_connected",
        (ssid, password, datetime.utcnow().isoformat())
    )
    db.commit()
    db.close()


def connect_saved_network(ssid: str) -> bool:
    """Re-activate a NetworkManager connection profile that already has credentials."""
    try:
        result = subprocess.run(
            ["/usr/bin/nmcli", "con", "up", ssid],
            capture_output=True, text=True, timeout=45
        )
        return "successfully activated" in result.stdout or "Connection successfully activated" in result.stdout
    except subprocess.TimeoutExpired:
        return False


def connect_to_network(ssid: str, password: str) -> bool:
    try:
        result = subprocess.run(
            ["/usr/bin/nmcli", "dev", "wifi", "connect", ssid, "password", password],
            capture_output=True, text=True, timeout=45
        )
        success = "successfully activated" in result.stdout
    except subprocess.TimeoutExpired:
        success = False
    if success:
        save_network(ssid, password)
    return success


def start_access_point():
    subprocess.run(["/usr/bin/nmcli", "con", "add", "type", "wifi", "ifname", "wlan0",
                    "con-name", "NomadEye-AP", "autoconnect", "no",
                    "ssid", cfg.ap_ssid], capture_output=True)
    subprocess.run(["/usr/bin/nmcli", "con", "modify", "NomadEye-AP",
                    "802-11-wireless.mode", "ap",
                    "802-11-wireless-security.key-mgmt", "wpa-psk",
                    "802-11-wireless-security.psk", cfg.ap_password,
                    "ipv4.method", "shared"], capture_output=True)
    subprocess.run(["/usr/bin/nmcli", "con", "up", "NomadEye-AP"], capture_output=True)


def stop_access_point():
    subprocess.run(["/usr/bin/nmcli", "con", "down", "NomadEye-AP"], capture_output=True)


def get_current_ip() -> str:
    """Get the wlan0 IP address, falling back to any non-virtual interface."""
    # Prefer wlan0 IP from nmcli (avoids Docker bridge and other virtual IPs)
    result = subprocess.run(
        ["/usr/bin/nmcli", "-t", "-f", "IP4.ADDRESS", "dev", "show", "wlan0"],
        capture_output=True, text=True
    )
    for line in result.stdout.splitlines():
        if line.startswith("IP4.ADDRESS"):
            val = line.split(":", 1)[-1].strip()
            if val:
                return val.split("/")[0]  # strip /24 CIDR notation

    # Fallback: skip Docker (172.x), loopback (127.x), link-local (169.x)
    result = subprocess.run(["/usr/bin/hostname", "-I"], capture_output=True, text=True)
    for ip in result.stdout.strip().split():
        if not any(ip.startswith(p) for p in ("172.", "127.", "169.")):
            return ip
    return ""


def is_connected() -> bool:
    result = subprocess.run(
        ["/usr/bin/nmcli", "-t", "-f", "STATE", "general"],
        capture_output=True, text=True
    )
    return "connected" in result.stdout


async def auto_connect_loop():
    while True:
        if not is_connected():
            known_ssids = {n["ssid"] for n in get_known_networks()}
            available = nmcli("-t", "-f", "SSID", "dev", "wifi", "list")
            for ssid in available.splitlines():
                if ssid in known_ssids:
                    # Re-activate the saved connection profile by name
                    subprocess.run(
                        ["/usr/bin/nmcli", "con", "up", ssid],
                        capture_output=True, timeout=30
                    )
                    if is_connected():
                        break
            else:
                start_access_point()
        await asyncio.sleep(30)
