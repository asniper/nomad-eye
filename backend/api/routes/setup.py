import asyncio
import socket
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from networking.manager import (
    get_known_networks, connect_to_network, connect_saved_network,
    stop_access_point, is_connected, nmcli, _terse_split
)

router = APIRouter()


class ConnectRequest(BaseModel):
    ssid: str
    password: str = ""


def _get_ssid() -> str:
    raw = nmcli("-t", "-f", "ACTIVE,SSID", "dev", "wifi")
    for line in raw.splitlines():
        parts = _terse_split(line, maxsplit=1)
        if len(parts) == 2 and parts[0].lower() == "yes":
            return parts[1]
    return ""


def _get_ip() -> str:
    result = __import__("subprocess").run(
        ["/usr/bin/nmcli", "-t", "-f", "IP4.ADDRESS", "dev", "show", "wlan0"],
        capture_output=True, text=True
    )
    for line in result.stdout.splitlines():
        if line.startswith("IP4.ADDRESS"):
            val = line.split(":", 1)[-1].strip()
            if val:
                return val.split("/")[0]
    return ""


def _finish_setup(ssid: str):
    import time
    deadline = time.time() + 30
    while time.time() < deadline:
        if is_connected() and _get_ssid() == ssid:
            break
        time.sleep(2)
    stop_access_point()


@router.get("/status")
def setup_status():
    return {
        "connected": is_connected(),
        "ssid": _get_ssid(),
        "ip": _get_ip(),
        "hostname": socket.gethostname(),
    }


@router.get("/scan")
def setup_scan():
    raw = nmcli("--terse", "--fields", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list")
    known_ssids = {n["ssid"] for n in get_known_networks()}
    seen = set()
    results = []
    for line in raw.splitlines():
        parts = _terse_split(line, maxsplit=2)
        ssid = parts[0] if parts else ""
        if not ssid or ssid in seen:
            continue
        seen.add(ssid)
        try:
            signal = int(parts[1]) if len(parts) > 1 and parts[1].strip().isdigit() else None
        except ValueError:
            signal = None
        results.append({
            "ssid": ssid,
            "signal": signal,
            "security": parts[2].strip() if len(parts) > 2 else "",
            "saved": ssid in known_ssids,
        })
    return sorted(results, key=lambda x: x["signal"] or 0, reverse=True)


@router.post("/connect")
async def setup_connect(body: ConnectRequest, background_tasks: BackgroundTasks):
    known_ssids = {n["ssid"] for n in get_known_networks()}
    if body.ssid in known_ssids and not body.password:
        background_tasks.add_task(connect_saved_network, body.ssid)
    else:
        background_tasks.add_task(connect_to_network, body.ssid, body.password)
    return {"status": "connecting", "ssid": body.ssid}


@router.post("/finish")
async def setup_finish(background_tasks: BackgroundTasks):
    background_tasks.add_task(stop_access_point)
    return {"status": "stopping"}
