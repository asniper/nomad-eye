import re
import sqlite3
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from models.database import get_db
from api.routes.auth import require_auth

router = APIRouter()
_scanner = None

_MAC_RE = re.compile(r'^[\da-f]{2}(?::[\da-f]{2}){5}$')


def set_scanner(s):
    global _scanner
    _scanner = s


class DeviceCreate(BaseModel):
    name: str
    mac_address: str


@router.get("/devices")
def list_devices(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    rows = db.execute(
        "SELECT * FROM presence_devices ORDER BY name COLLATE NOCASE"
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/devices")
def add_device(body: DeviceCreate, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    mac = body.mac_address.lower().strip()
    if not _MAC_RE.match(mac):
        raise HTTPException(status_code=400, detail="Invalid MAC address — expected XX:XX:XX:XX:XX:XX")
    try:
        cursor = db.execute(
            "INSERT INTO presence_devices (name, mac_address) VALUES (?, ?)",
            (body.name.strip(), mac)
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="MAC address already in watch list")
    row = db.execute("SELECT * FROM presence_devices WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return dict(row)


@router.patch("/devices/{device_id}")
def patch_device(device_id: int, body: dict, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    fields, values = [], []
    if 'active' in body:
        fields.append('active = ?')
        values.append(1 if body['active'] else 0)
    if 'name' in body:
        fields.append('name = ?')
        values.append(body['name'])
    if fields:
        values.append(device_id)
        db.execute(f"UPDATE presence_devices SET {', '.join(fields)} WHERE id = ?", values)
        db.commit()
    row = db.execute("SELECT * FROM presence_devices WHERE id = ?", (device_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return dict(row)


@router.delete("/devices/{device_id}")
def delete_device(device_id: int, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    db.execute("DELETE FROM presence_devices WHERE id = ?", (device_id,))
    db.commit()
    return {"deleted": device_id}


@router.get("/scan")
def scan_network(_=Depends(require_auth)):
    """Scan the local network via arp-scan and return all discovered devices (~2s)."""
    if _scanner is None:
        raise HTTPException(status_code=503, detail="Scanner not initialized")
    results = _scanner.scan_now()
    if results is None:
        raise HTTPException(
            status_code=503,
            detail="arp-scan failed — ensure arp-scan is installed: apt install arp-scan"
        )
    return {"devices": results, "count": len(results)}


@router.get("/status")
def presence_status(_=Depends(require_auth)):
    if _scanner is None:
        return {"available": False}
    info = _scanner.last_info()
    return {
        "available": True,
        "last_scan": info['last_scan'],
        "scanned_count": len(info['devices']),
    }
