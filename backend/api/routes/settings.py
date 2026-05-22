import asyncio
import sqlite3
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from models.database import get_db
from api.routes.auth import require_auth

router = APIRouter()

_pipeline = None


def set_pipeline(pipeline):
    global _pipeline
    _pipeline = pipeline


class ConfigItem(BaseModel):
    key: str
    value: str


@router.get("/")
def get_settings_all(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    rows = db.execute("SELECT key, value FROM app_config").fetchall()
    return {r["key"]: r["value"] for r in rows}


@router.post("/")
async def set_setting(body: ConfigItem, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    db.execute("INSERT INTO app_config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
               (body.key, body.value))
    db.commit()
    _CONF_KEYS = {
        'confidence_people': 'people',
        'confidence_vehicles': 'vehicles',
        'confidence_animals': 'animals',
        'confidence_other': 'other',
    }
    if body.key == 'yolo_model' and _pipeline is not None:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _pipeline.reload_model, f"{body.value}.pt")
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
    elif body.key.startswith('category_enabled_') and _pipeline is not None:
        category = body.key[len('category_enabled_'):]
        _pipeline.set_category_enabled(category, body.value != '0')
    return {"saved": True}
