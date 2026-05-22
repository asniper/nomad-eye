import asyncio
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from pydantic import BaseModel
from networking.manager import (
    get_known_networks, connect_to_network, connect_saved_network, save_network,
    start_access_point, stop_access_point, get_current_ip, is_connected, nmcli,
    _terse_split
)
from api.routes.auth import require_auth

router = APIRouter()


class ConnectRequest(BaseModel):
    ssid: str
    password: str


class SavedConnectRequest(BaseModel):
    ssid: str


class AddNetworkRequest(BaseModel):
    ssid: str
    password: str


def _get_current_ssid() -> str:
    raw = nmcli("-t", "-f", "ACTIVE,SSID", "dev", "wifi")
    for line in raw.splitlines():
        parts = _terse_split(line, maxsplit=1)
        if len(parts) == 2 and parts[0].lower() == "yes":
            return parts[1]
    return ""


def _is_ap_active() -> bool:
    raw = nmcli("-t", "-f", "NAME,STATE", "con", "show", "--active")
    return any("NomadEye-AP" in line for line in raw.splitlines())


def _get_hostname() -> str:
    import socket
    return socket.gethostname()


@router.get("/")
def network_status(_=Depends(require_auth)):
    return {
        "connected": is_connected(),
        "ip": get_current_ip(),
        "ssid": _get_current_ssid(),
        "ap_active": _is_ap_active(),
        "hostname": _get_hostname(),
    }


@router.get("/known")
def known_networks(_=Depends(require_auth)):
    return get_known_networks()


@router.delete("/known/{ssid}")
def delete_network(ssid: str, _=Depends(require_auth)):
    import subprocess
    result = subprocess.run(
        ["/usr/bin/nmcli", "con", "delete", ssid],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=result.stderr.strip() or "Failed to delete network")
    return {"deleted": ssid}


@router.post("/connect")
async def connect(body: ConnectRequest, background_tasks: BackgroundTasks, _=Depends(require_auth)):
    """Kick off a WiFi connection attempt and return immediately.
    The client should poll GET /api/network/ to detect when it connects."""
    background_tasks.add_task(connect_to_network, body.ssid, body.password)
    return {"status": "connecting", "ssid": body.ssid}


@router.post("/connect-saved")
async def connect_saved(body: SavedConnectRequest, background_tasks: BackgroundTasks, _=Depends(require_auth)):
    """Re-activate a saved NetworkManager profile (no password needed)."""
    background_tasks.add_task(connect_saved_network, body.ssid)
    return {"status": "connecting", "ssid": body.ssid}


@router.post("/add")
def add_network(body: AddNetworkRequest, _=Depends(require_auth)):
    save_network(body.ssid, body.password)
    return {"saved": True}


@router.get("/scan")
def scan(_=Depends(require_auth)):
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


@router.post("/ap/start")
def ap_start(_=Depends(require_auth)):
    try:
        start_access_point()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ap": "started", "active": _is_ap_active()}


@router.post("/ap/stop")
def ap_stop(_=Depends(require_auth)):
    stop_access_point()
    return {"ap": "stopped", "active": _is_ap_active()}
