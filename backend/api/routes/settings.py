from fastapi import APIRouter, Depends
from pydantic import BaseModel
from models.database import get_db
from api.routes.auth import require_auth
import sqlite3

router = APIRouter()

class ConfigItem(BaseModel):
    key: str
    value: str

@router.get("/")
def get_settings_all(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    rows = db.execute("SELECT key, value FROM app_config").fetchall()
    return {r["key"]: r["value"] for r in rows}

@router.post("/")
def set_setting(body: ConfigItem, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    db.execute("INSERT INTO app_config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
               (body.key, body.value))
    db.commit()
    return {"saved": True}
