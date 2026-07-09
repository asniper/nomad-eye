import os
import shutil
import sqlite3
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from models.database import get_db
from api.routes.auth import require_admin
from config.settings import get_settings
from storage.manager import (
    list_external_devices, mount_device, unmount_device,
    format_device, get_active_images_dir, INTERNAL_IMAGES_DIR,
    _get_mount_point,
)

router = APIRouter()
cfg = get_settings()


def _primary_device() -> str | None:
    db = sqlite3.connect(cfg.db_path)
    row = db.execute("SELECT value FROM app_config WHERE key='storage_primary_device'").fetchone()
    db.close()
    return row[0] if row else None


def _clips_primary_device() -> str | None:
    db = sqlite3.connect(cfg.db_path)
    row = db.execute("SELECT value FROM app_config WHERE key='clips_primary_device'").fetchone()
    db.close()
    return row[0] if (row and row[0]) else None


@router.get("/devices")
def get_devices(_=Depends(require_admin)):
    devices = list_external_devices()
    primary = _primary_device()
    clips_primary = _clips_primary_device()
    for d in devices:
        d["is_primary"] = d["name"] == primary
        d["is_clips_primary"] = d["name"] == clips_primary
    return {"devices": devices, "primary": primary, "clips_primary": clips_primary}


@router.post("/devices/{device_name}/mount")
def mount(device_name: str, _=Depends(require_admin)):
    if not _valid_device_name(device_name):
        raise HTTPException(status_code=400, detail="Invalid device name")
    ok, msg = mount_device(device_name)
    if not ok:
        raise HTTPException(status_code=500, detail=msg)
    return {"mounted": True, "mount_point": msg}


@router.post("/devices/{device_name}/unmount")
def unmount(device_name: str, _=Depends(require_admin)):
    if not _valid_device_name(device_name):
        raise HTTPException(status_code=400, detail="Invalid device name")
    db = sqlite3.connect(cfg.db_path)
    if _primary_device() == device_name:
        db.execute("DELETE FROM app_config WHERE key='storage_primary_device'")
    if _clips_primary_device() == device_name:
        db.execute("UPDATE app_config SET value='' WHERE key='clips_primary_device'")
    db.commit()
    db.close()
    ok, msg = unmount_device(device_name)
    if not ok:
        raise HTTPException(status_code=500, detail=msg)
    return {"unmounted": True}


@router.post("/devices/{device_name}/format")
def format_dev(device_name: str, _=Depends(require_admin)):
    if not _valid_device_name(device_name):
        raise HTTPException(status_code=400, detail="Invalid device name")
    db = sqlite3.connect(cfg.db_path)
    if _primary_device() == device_name:
        db.execute("DELETE FROM app_config WHERE key='storage_primary_device'")
    if _clips_primary_device() == device_name:
        db.execute("UPDATE app_config SET value='' WHERE key='clips_primary_device'")
    db.commit()
    db.close()
    ok, msg = format_device(device_name)
    if not ok:
        raise HTTPException(status_code=500, detail=msg)
    return {"formatted": True}


@router.post("/devices/{device_name}/set-primary")
def set_primary(device_name: str, _=Depends(require_admin)):
    if not _valid_device_name(device_name):
        raise HTTPException(status_code=400, detail="Invalid device name")
    mp = _get_mount_point(device_name)
    if not mp:
        raise HTTPException(status_code=400, detail="Device is not mounted")
    db = sqlite3.connect(cfg.db_path)
    db.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES ('storage_primary_device', ?)",
        (device_name,)
    )
    db.commit()
    db.close()
    return {"primary": device_name, "mount_point": mp}


@router.post("/devices/{device_name}/set-clips-primary")
def set_clips_primary(device_name: str, _=Depends(require_admin)):
    if not _valid_device_name(device_name):
        raise HTTPException(status_code=400, detail="Invalid device name")
    mp = _get_mount_point(device_name)
    if not mp:
        raise HTTPException(status_code=400, detail="Device is not mounted")
    db = sqlite3.connect(cfg.db_path)
    db.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES ('clips_primary_device', ?)",
        (device_name,)
    )
    db.commit()
    db.close()
    return {"clips_primary": device_name, "mount_point": mp}


@router.post("/set-primary-internal")
def set_primary_internal(_=Depends(require_admin)):
    db = sqlite3.connect(cfg.db_path)
    db.execute("DELETE FROM app_config WHERE key='storage_primary_device'")
    db.commit()
    db.close()
    return {"primary": "internal", "path": INTERNAL_IMAGES_DIR}


@router.get("/status")
def storage_status(_=Depends(require_admin)):
    active_dir = get_active_images_dir()
    primary = _primary_device()
    try:
        disk = shutil.disk_usage(active_dir)
        total, used, free = disk.total, disk.used, disk.free
    except Exception:
        total = used = free = 0
    image_bytes = sum(
        f.stat().st_size for f in Path(active_dir).glob("*") if f.is_file()
    ) if Path(active_dir).exists() else 0
    return {
        "active_dir": active_dir,
        "primary_device": primary,
        "using_external": primary is not None,
        "disk_total": total,
        "disk_used": used,
        "disk_free": free,
        "image_bytes": image_bytes,
    }


@router.get("/browse")
def browse_files(_=Depends(require_admin)):
    active_dir = Path(get_active_images_dir())
    if not active_dir.exists():
        return {"files": [], "total_bytes": 0}
    files = []
    for item in sorted(active_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if item.is_file():
            stat = item.stat()
            files.append({
                "name": item.name,
                "size": stat.st_size,
                "modified": stat.st_mtime,
            })
    total_bytes = sum(f["size"] for f in files)
    return {"files": files[:200], "total": len(files), "total_bytes": total_bytes}


def _valid_device_name(name: str) -> bool:
    import re
    return bool(re.match(r'^[a-z0-9]+$', name)) and len(name) <= 32
