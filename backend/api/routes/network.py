from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from networking.manager import (
    get_known_networks, connect_to_network, save_network,
    start_access_point, stop_access_point, get_current_ip, is_connected, nmcli
)
from api.routes.auth import require_auth

router = APIRouter()

class ConnectRequest(BaseModel):
    ssid: str
    password: str

class AddNetworkRequest(BaseModel):
    ssid: str
    password: str

def _get_current_ssid() -> str:
    raw = nmcli("-t", "-f", "ACTIVE,SSID", "dev", "wifi")
    for line in raw.splitlines():
        parts = line.split(":", 1)
        if len(parts) == 2 and parts[0].lower() == "yes":
            return parts[1]
    return ""

def _is_ap_active() -> bool:
    raw = nmcli("-t", "-f", "NAME,STATE", "con", "show", "--active")
    return any("NomadEye-AP" in line for line in raw.splitlines())

@router.get("/")
def network_status(_=Depends(require_auth)):
    ssid = _get_current_ssid()
    return {
        "connected": is_connected(),
        "ip": get_current_ip(),
        "ssid": ssid,
        "ap_active": _is_ap_active(),
    }

@router.get("/known")
def known_networks(_=Depends(require_auth)):
    return get_known_networks()

@router.post("/connect")
def connect(body: ConnectRequest, _=Depends(require_auth)):
    success = connect_to_network(body.ssid, body.password)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to connect to network")
    return {"connected": True, "ip": get_current_ip()}

@router.post("/add")
def add_network(body: AddNetworkRequest, _=Depends(require_auth)):
    save_network(body.ssid, body.password)
    return {"saved": True}

@router.get("/scan")
def scan(_=Depends(require_auth)):
    raw = nmcli("--terse", "--fields", "SSID,SIGNAL,SECURITY,IN-USE", "dev", "wifi", "list")
    known_ssids = {n["ssid"] for n in get_known_networks()}
    seen = set()
    results = []
    for line in raw.splitlines():
        parts = line.split(":", 3)
        ssid = parts[0].strip() if parts else ""
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
    start_access_point()
    return {"ap": "started"}

@router.post("/ap/stop")
def ap_stop(_=Depends(require_auth)):
    stop_access_point()
    return {"ap": "stopped"}
