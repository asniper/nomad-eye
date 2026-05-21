import subprocess
import sqlite3
import asyncio
from datetime import datetime
from config.settings import get_settings

cfg = get_settings()

def nmcli(*args) -> str:
    result = subprocess.run(["/usr/bin/nmcli"] + list(args), capture_output=True, text=True)
    return result.stdout.strip()

def get_known_networks() -> list:
    db = sqlite3.connect(cfg.db_path)
    db.row_factory = sqlite3.Row
    rows = db.execute("SELECT * FROM networks ORDER BY last_connected DESC").fetchall()
    db.close()
    return [dict(r) for r in rows]

def save_network(ssid: str, password: str):
    db = sqlite3.connect(cfg.db_path)
    db.execute(
        "INSERT INTO networks (ssid, password, last_connected) VALUES (?, ?, ?) "
        "ON CONFLICT(ssid) DO UPDATE SET password=excluded.password, last_connected=excluded.last_connected",
        (ssid, password, datetime.utcnow().isoformat())
    )
    db.commit()
    db.close()

def connect_to_network(ssid: str, password: str) -> bool:
    result = subprocess.run(
        ["/usr/bin/nmcli", "dev", "wifi", "connect", ssid, "password", password],
        capture_output=True, text=True
    )
    success = "successfully activated" in result.stdout
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
    result = subprocess.run(["/usr/bin/hostname", "-I"], capture_output=True, text=True)
    parts = result.stdout.strip().split()
    return parts[0] if parts else ""

def is_connected() -> bool:
    result = subprocess.run(["/usr/bin/nmcli", "-t", "-f", "STATE", "general"], capture_output=True, text=True)
    return "connected" in result.stdout

async def auto_connect_loop():
    while True:
        if not is_connected():
            known = get_known_networks()
            available = nmcli("-t", "-f", "SSID", "dev", "wifi", "list")
            available_ssids = set(available.splitlines())
            connected = False
            for net in known:
                if net["ssid"] in available_ssids and net["auto_connect"]:
                    connected = connect_to_network(net["ssid"], net["password"])
                    if connected:
                        break
            if not connected:
                start_access_point()
        await asyncio.sleep(30)
