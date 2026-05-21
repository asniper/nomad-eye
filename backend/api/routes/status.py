from fastapi import APIRouter, Depends
from pydantic import BaseModel
from models.database import get_db
from api.routes.auth import require_auth
import sqlite3

router = APIRouter()

VALID_STATUSES = ["home", "away", "sleep", "vacation"]

class StatusUpdate(BaseModel):
    status: str

@router.get("/")
def get_status(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    row = db.execute("SELECT status FROM device_status WHERE id = 1").fetchone()
    return {"status": row["status"] if row else "home"}

@router.post("/")
def set_status(body: StatusUpdate, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    if body.status not in VALID_STATUSES:
        return {"error": f"Invalid status. Choose from: {VALID_STATUSES}"}
    db.execute("UPDATE device_status SET status = ? WHERE id = 1", (body.status,))
    db.commit()
    return {"status": body.status}
