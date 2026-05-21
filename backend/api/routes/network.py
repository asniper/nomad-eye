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

@router.get("/")
def network_status(_=Depends(require_auth)):
    return {
        "connected": is_connected(),
        "ip": get_current_ip(),
    }

@router.get("/known")
def known_networks(_=Depends(require_auth)):
    return get_known_networks()

@router.post("/connect")
def connect(body: ConnectRequest, _=Depends(require_auth)):
    success = connect_to_network(body.ssid, body.password)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to connect")
    return {"connected": True, "ip": get_current_ip()}

@router.post("/add")
def add_network(body: AddNetworkRequest, _=Depends(require_auth)):
    save_network(body.ssid, body.password)
    return {"saved": True}

@router.get("/scan")
def scan(_=Depends(require_auth)):
    raw = nmcli("-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list")
    results = []
    for line in raw.splitlines():
        parts = line.split(":")
        if len(parts) >= 2 and parts[0]:
            results.append({"ssid": parts[0], "signal": parts[1] if len(parts) > 1 else "", "security": parts[2] if len(parts) > 2 else ""})
    return results

@router.post("/ap/start")
def ap_start(_=Depends(require_auth)):
    start_access_point()
    return {"ap": "started"}

@router.post("/ap/stop")
def ap_stop(_=Depends(require_auth)):
    stop_access_point()
    return {"ap": "stopped"}
