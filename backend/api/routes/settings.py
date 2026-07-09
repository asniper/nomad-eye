import asyncio
import subprocess
import sqlite3
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from models.database import get_db
from api.routes.auth import require_admin

router = APIRouter()

_pipeline = None


def set_pipeline(pipeline):
    global _pipeline
    _pipeline = pipeline


class ConfigItem(BaseModel):
    key: str
    value: str


@router.get("/models")
def get_models(_=Depends(require_admin)):
    import platform
    from detection.detector import MODELS
    machine = platform.machine().lower()
    is_x86 = machine in ('x86_64', 'amd64', 'i386', 'i686')
    result = []
    for m in MODELS:
        entry = dict(m)
        if m['key'] in ('owlv2', 'grounding-dino', 'megadetector'):
            entry['available'] = is_x86
        else:
            entry['available'] = True
        result.append(entry)
    return result


@router.get("/")
def get_settings_all(db: sqlite3.Connection = Depends(get_db), _=Depends(require_admin)):
    rows = db.execute("SELECT key, value FROM app_config").fetchall()
    return {r["key"]: r["value"] for r in rows}


@router.post("/")
async def set_setting(body: ConfigItem, db: sqlite3.Connection = Depends(get_db), _=Depends(require_admin)):
    db.execute("INSERT INTO app_config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
               (body.key, body.value))
    db.commit()
    _CONF_KEYS = {
        'confidence_people': 'people',
        'confidence_vehicles': 'vehicles',
        'confidence_animals': 'animals',
        'confidence_other': 'other',
    }
    if body.key in ('yolo_model', 'detection_model') and _pipeline is not None:
        model_key = body.value if body.key == 'detection_model' else f"{body.value}.pt"
        classes_row = db.execute("SELECT value FROM app_config WHERE key='detection_classes'").fetchone()
        classes = _parse_classes(classes_row['value'] if classes_row else None)
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(None, _pipeline.reload_model, model_key, classes)
        except Exception as e:
            # Roll back the DB value so the UI stays consistent with what's actually loaded
            db.execute(
                "INSERT INTO app_config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (body.key, _pipeline._detection_model_key),
            )
            db.commit()
            raise HTTPException(status_code=400, detail=str(e))
    elif body.key == 'detection_classes' and _pipeline is not None:
        model_row = db.execute(
            "SELECT value FROM app_config WHERE key IN ('detection_model','yolo_model') ORDER BY key"
        ).fetchone()
        model_key = model_row['value'] if model_row else 'yolov8n'
        classes = _parse_classes(body.value)
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(None, _pipeline.reload_model, model_key, classes)
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))
    elif body.key in _CONF_KEYS and _pipeline is not None:
        try:
            _pipeline.set_category_confidence(_CONF_KEYS[body.key], float(body.value))
        except ValueError:
            pass
    elif body.key == 'confidence_faces' and _pipeline is not None:
        try:
            _pipeline.set_face_confidence(float(body.value))
        except ValueError:
            pass
    elif body.key == 'motion_threshold' and _pipeline is not None:
        try:
            _pipeline.set_motion_threshold(int(body.value))
        except ValueError:
            pass
    elif body.key == 'motion_scale' and _pipeline is not None:
        try:
            _pipeline.set_motion_scale(float(body.value))
        except ValueError:
            pass
    elif body.key == 'detection_cooldown' and _pipeline is not None:
        try:
            _pipeline.set_detection_cooldown(float(body.value))
        except ValueError:
            pass
    elif body.key.startswith('category_enabled_') and _pipeline is not None:
        category = body.key[len('category_enabled_'):]
        _pipeline.set_category_enabled(category, body.value != '0')
    elif body.key in ('clips_enabled', 'clips_pre_roll', 'clips_post_roll') and _pipeline is not None:
        enabled_row = db.execute("SELECT value FROM app_config WHERE key='clips_enabled'").fetchone()
        pre_row = db.execute("SELECT value FROM app_config WHERE key='clips_pre_roll'").fetchone()
        post_row = db.execute("SELECT value FROM app_config WHERE key='clips_post_roll'").fetchone()
        _pipeline.set_clips_config(
            enabled=(enabled_row['value'] if enabled_row else '0') != '0',
            pre_roll=int(pre_row['value']) if pre_row else 5,
            post_roll=int(post_row['value']) if post_row else 10,
        )
    elif body.key == 'timezone':
        _apply_system_timezone(body.value)
    elif body.key == 'ai_enabled' and _pipeline is not None:
        _pipeline.set_ai_enabled(body.value != '0')
    elif body.key in ('video_width', 'video_height', 'video_fps') and _pipeline is not None:
        s = db.execute("SELECT key, value FROM app_config WHERE key IN ('video_width','video_height','video_fps')").fetchall()
        kv = {r['key']: r['value'] for r in s}
        try:
            _pipeline.set_video_quality(
                int(kv.get('video_width', 1280)),
                int(kv.get('video_height', 720)),
                int(kv.get('video_fps', 15)),
            )
        except ValueError:
            pass
    return {"saved": True}


@router.get("/notification-url")
def get_notification_url(db: sqlite3.Connection = Depends(get_db), _=Depends(require_admin)):
    from notifications.link import get_notification_base_url
    return {"url": get_notification_base_url(db)}


def _parse_classes(value: str):
    """Parse a comma-separated class string into a list, or None if empty."""
    if not value or not value.strip():
        return None
    return [c.strip() for c in value.split(',') if c.strip()]


def _apply_system_timezone(tz: str):
    """Update the Linux system timezone via timedatectl, falling back to direct symlink."""
    try:
        result = subprocess.run(
            ['timedatectl', 'set-timezone', tz],
            capture_output=True, timeout=10
        )
        if result.returncode == 0:
            return
    except Exception:
        pass
    # Fallback: try with sudo (requires passwordless sudoers entry for timedatectl)
    try:
        subprocess.run(
            ['sudo', 'timedatectl', 'set-timezone', tz],
            capture_output=True, timeout=10
        )
    except Exception:
        pass
