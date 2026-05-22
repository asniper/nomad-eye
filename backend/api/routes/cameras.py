import asyncio
import glob
import os
import sqlite3
import cv2
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from pydantic import BaseModel
from api.routes.auth import require_auth
from camera.capture import CameraCapture
from detection.detector import CATEGORY_COLORS_BGR
from models.database import get_db
from config.settings import get_settings

router = APIRouter()

_pipeline = None


def set_pipeline(pipeline):
    global _pipeline
    _pipeline = pipeline


class CameraNameBody(BaseModel):
    name: str


def _get_usb_id(video_path: str) -> str:
    """Return a stable USB identifier for a /dev/videoN device.

    Tries /dev/v4l/by-id (serial-based, most stable), then /dev/v4l/by-path
    (port-based, stable per USB slot), then falls back to the bare device name.
    Only considers *-video-index0 entries so multi-node cameras don't produce
    duplicates.
    """
    video_name = os.path.basename(video_path)
    for d in ['/dev/v4l/by-id', '/dev/v4l/by-path']:
        try:
            for entry in sorted(os.listdir(d)):
                if 'video-index0' not in entry:
                    continue
                target = os.path.basename(os.readlink(os.path.join(d, entry)))
                if target == video_name:
                    return entry
        except OSError:
            continue
    return video_name


def _get_or_create_camera_id(db: sqlite3.Connection, usb_id: str) -> int:
    """Look up usb_id in the cameras table; insert with next available ID if new."""
    row = db.execute("SELECT camera_id FROM cameras WHERE usb_id=?", (usb_id,)).fetchone()
    if row:
        return row['camera_id']
    existing = {r['camera_id'] for r in db.execute("SELECT camera_id FROM cameras").fetchall()}
    cam_id = next(i for i in range(1000) if i not in existing)
    db.execute(
        "INSERT INTO cameras (camera_id, usb_id, created_at) VALUES (?,?,datetime('now'))",
        (cam_id, usb_id),
    )
    db.commit()
    return cam_id


def _probe_device(path: str) -> bool:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return False
    ret, _ = cap.read()
    cap.release()
    return ret


def _get_names(db: sqlite3.Connection) -> dict:
    rows = db.execute(
        "SELECT key, value FROM app_config WHERE key LIKE 'camera_name_%'"
    ).fetchall()
    return {int(row['key'].replace('camera_name_', '')): row['value'] for row in rows}


def _cam_dict(cam, names: dict) -> dict:
    return {
        "id": cam.camera_id,
        "alive": cam.is_alive(),
        "device": cam.device_path,
        "usb_id": cam.usb_id,
        "name": names.get(cam.camera_id, ''),
    }


async def scan_and_refresh(db: sqlite3.Connection = None) -> list:
    """Prune dead cameras, probe /dev/video* for new ones, return updated list.

    Camera IDs are assigned from the cameras table keyed on USB device identity,
    so the same physical camera always gets the same ID regardless of which
    /dev/videoN node the kernel assigns it.
    """
    if _pipeline is None:
        return []

    existing_paths, _ = _pipeline.prune_dead_and_get_state()
    existing_cam_ids = {c.camera_id for c in _pipeline._cameras}

    owned_db = db is None
    if owned_db:
        cfg = get_settings()
        _db = sqlite3.connect(cfg.db_path, timeout=15)
        _db.row_factory = sqlite3.Row
        _db.execute("PRAGMA journal_mode=WAL")
    else:
        _db = db

    loop = asyncio.get_event_loop()
    new_captures = []

    try:
        for path in sorted(glob.glob("/dev/video*")):
            if path in existing_paths:
                continue

            usb_id = _get_usb_id(path)
            cam_id = _get_or_create_camera_id(_db, usb_id)

            if cam_id in existing_cam_ids:
                continue

            ok = await loop.run_in_executor(None, _probe_device, path)
            if ok:
                dev_idx = int(path.replace("/dev/video", ""))
                cap = CameraCapture(camera_id=cam_id, device_index=dev_idx, usb_id=usb_id)
                cap.start()
                new_captures.append(cap)
                existing_cam_ids.add(cam_id)
    finally:
        if owned_db:
            _db.close()

    if new_captures:
        _pipeline.refresh(new_captures)

    return _pipeline._cameras


@router.get("/")
def list_cameras(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    if _pipeline is None:
        return []
    names = _get_names(db)
    with _pipeline._lock:
        return [_cam_dict(cam, names) for cam in _pipeline._cameras]


@router.post("/refresh")
async def refresh_cameras(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    cams = await scan_and_refresh(db)
    names = _get_names(db)
    return [_cam_dict(cam, names) for cam in cams]


@router.patch("/{camera_id}/name")
def set_camera_name(
    camera_id: int,
    body: CameraNameBody,
    db: sqlite3.Connection = Depends(get_db),
    _=Depends(require_auth),
):
    db.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES (?,?)",
        (f"camera_name_{camera_id}", body.name.strip()),
    )
    db.commit()
    return {"camera_id": camera_id, "name": body.name.strip()}


@router.delete("/{camera_id}")
def remove_camera(camera_id: int, _=Depends(require_auth)):
    """Manually remove a camera from the pipeline (use to clean up stale entries)."""
    if _pipeline is None:
        return {"ok": False}
    with _pipeline._lock:
        cam = next((c for c in _pipeline._cameras if c.camera_id == camera_id), None)
        if cam:
            cam.stop()
            _pipeline._cameras.remove(cam)
            _pipeline._detectors.pop(camera_id, None)
            _pipeline._latest_detections.pop(camera_id, None)
            _pipeline._overlay_enabled.pop(camera_id, None)
    return {"ok": True}


@router.post("/{camera_id}/reload")
async def reload_camera(camera_id: int, _=Depends(require_auth)):
    if _pipeline is None:
        return {"ok": False}
    loop = asyncio.get_event_loop()
    ok = await loop.run_in_executor(None, _pipeline.reload_camera, camera_id)
    return {"ok": ok}


@router.post("/{camera_id}/reset-tracking")
def reset_tracking(camera_id: int, _=Depends(require_auth)):
    if _pipeline:
        _pipeline.reset_tracking(camera_id)
    return {"ok": True}


@router.post("/{camera_id}/overlay")
def toggle_overlay(camera_id: int, enabled: bool, _=Depends(require_auth)):
    if _pipeline:
        _pipeline.set_overlay(camera_id, enabled)
    return {"camera_id": camera_id, "overlay": enabled}


@router.websocket("/{camera_id}/stream")
async def stream(websocket: WebSocket, camera_id: int):
    await websocket.accept()
    if _pipeline is None:
        await websocket.close()
        return
    cam = next((c for c in _pipeline._cameras if c.camera_id == camera_id), None)
    if not cam:
        await websocket.close()
        return

    # Categories the client wants drawn. None = all. Updated via incoming WS messages.
    hidden_categories: set = set()

    async def read_client():
        nonlocal hidden_categories
        try:
            async for msg in websocket.iter_text():
                import json
                try:
                    data = json.loads(msg)
                    if "hidden_categories" in data:
                        hidden_categories = set(data["hidden_categories"])
                except Exception:
                    pass
        except Exception:
            pass

    reader = asyncio.create_task(read_client())
    try:
        while True:
            frame_obj = cam.get_frame()
            if frame_obj is not None:
                frame = frame_obj.data.copy()
                if _pipeline._overlay_enabled.get(camera_id):
                    detections = _pipeline.get_latest(camera_id) or []
                    for d in detections:
                        if d.category in hidden_categories:
                            continue
                        x1, y1, x2, y2 = d.bbox
                        color = CATEGORY_COLORS_BGR.get(d.category, (128, 128, 128))
                        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                        cv2.putText(frame, f"{d.label} {d.confidence:.0%}", (x1, y1 - 8),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
                _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                try:
                    await websocket.send_bytes(buf.tobytes())
                except Exception:
                    break
            await asyncio.sleep(0.033)
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        reader.cancel()
