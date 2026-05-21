from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from models.database import get_db
from api.routes.auth import require_auth
import sqlite3

router = APIRouter()

@router.get("/")
def list_detections(
    camera_id: int = None,
    category: str = None,
    label: str = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: sqlite3.Connection = Depends(get_db),
    _=Depends(require_auth)
):
    query = "SELECT * FROM detections WHERE 1=1"
    params = []
    if camera_id is not None:
        query += " AND camera_id = ?"
        params.append(camera_id)
    if category:
        query += " AND category = ?"
        params.append(category)
    if label:
        query += " AND label = ?"
        params.append(label)
    query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    params += [limit, offset]
    rows = db.execute(query, params).fetchall()
    return [dict(r) for r in rows]

@router.get("/{detection_id}/image")
def get_image(detection_id: int, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    row = db.execute("SELECT image_path FROM detections WHERE id = ?", (detection_id,)).fetchone()
    if not row or not row["image_path"]:
        return {"error": "not found"}
    return FileResponse(row["image_path"])
