import os
import shutil
from pathlib import Path
from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from models.database import get_db
from api.routes.auth import require_auth
from config.settings import get_settings
from storage.manager import get_active_images_dir
import sqlite3

router = APIRouter()
cfg = get_settings()


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


@router.get("/events")
def list_events(
    camera_id: int = None,
    category: str = None,
    label: str = None,
    limit: int = Query(25, le=100),
    offset: int = 0,
    db: sqlite3.Connection = Depends(get_db),
    _=Depends(require_auth)
):
    query = """
        SELECT
            event_id,
            category,
            label,
            camera_id,
            MIN(timestamp) as first_seen,
            MAX(timestamp) as last_seen,
            COUNT(*) as screenshot_count,
            GROUP_CONCAT(id) as detection_ids
        FROM detections
        WHERE event_id IS NOT NULL
    """
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
    count_query = "SELECT COUNT(DISTINCT event_id) FROM detections WHERE event_id IS NOT NULL"
    count_params = []
    if camera_id is not None:
        count_query += " AND camera_id = ?"
        count_params.append(camera_id)
    if category:
        count_query += " AND category = ?"
        count_params.append(category)
    if label:
        count_query += " AND label = ?"
        count_params.append(label)
    total = db.execute(count_query, count_params).fetchone()[0]

    query += " GROUP BY event_id ORDER BY MAX(timestamp) DESC LIMIT ? OFFSET ?"
    params += [limit, offset]
    rows = db.execute(query, params).fetchall()
    result = []
    for r in rows:
        row = dict(r)
        ids = row.pop("detection_ids", "") or ""
        row["detection_ids"] = [int(x) for x in ids.split(",") if x]
        result.append(row)
    return {"events": result, "total": total}


@router.get("/events/{event_id}")
def get_event(
    event_id: str,
    db: sqlite3.Connection = Depends(get_db),
    _=Depends(require_auth)
):
    meta = db.execute("""
        SELECT event_id, category, label, camera_id,
               MIN(timestamp) as first_seen, MAX(timestamp) as last_seen,
               COUNT(*) as screenshot_count
        FROM detections WHERE event_id = ?
    """, (event_id,)).fetchone()
    if not meta or not meta['event_id']:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Event not found")
    result = dict(meta)
    records = db.execute(
        "SELECT id FROM detections WHERE event_id = ? ORDER BY confidence DESC",
        (event_id,)
    ).fetchall()
    result['detection_ids'] = [r['id'] for r in records]
    return result


@router.get("/storage")
def get_storage(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    images_dir = Path(get_active_images_dir())
    image_bytes = sum(f.stat().st_size for f in images_dir.glob("**/*") if f.is_file()) if images_dir.exists() else 0
    disk = shutil.disk_usage(str(images_dir) if images_dir.exists() else "/")
    counts = db.execute(
        "SELECT category, COUNT(*) as n FROM detections GROUP BY category"
    ).fetchall()
    total = db.execute("SELECT COUNT(*) as n FROM detections").fetchone()["n"]
    return {
        "image_bytes": image_bytes,
        "disk_total": disk.total,
        "disk_used": disk.used,
        "disk_free": disk.free,
        "total_detections": total,
        "by_category": {r["category"]: r["n"] for r in counts},
    }


class PurgeBody(BaseModel):
    category: str = "all"
    images_only: bool = False


@router.delete("/purge")
def purge_detections(body: PurgeBody, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    # Collect image paths targeted by this purge
    if body.category == "all":
        targeted = db.execute("SELECT DISTINCT image_path FROM detections WHERE image_path IS NOT NULL").fetchall()
    else:
        targeted = db.execute(
            "SELECT DISTINCT image_path FROM detections WHERE category = ? AND image_path IS NOT NULL",
            (body.category,)
        ).fetchall()
    targeted_paths = {r["image_path"] for r in targeted}

    deleted_records = 0
    if not body.images_only:
        if body.category == "all":
            deleted_records = db.execute("DELETE FROM detections").rowcount
        else:
            deleted_records = db.execute("DELETE FROM detections WHERE category = ?", (body.category,)).rowcount
        db.commit()

    # Only delete an image file if no remaining detection record still references it
    still_referenced = {
        r["image_path"]
        for r in db.execute("SELECT DISTINCT image_path FROM detections WHERE image_path IS NOT NULL").fetchall()
    }
    deleted_images = 0
    for path in targeted_paths:
        if path not in still_referenced:
            try:
                os.remove(path)
                deleted_images += 1
            except OSError:
                pass

    if body.images_only:
        if body.category == "all":
            db.execute("UPDATE detections SET image_path = NULL WHERE image_path IS NOT NULL")
        else:
            db.execute("UPDATE detections SET image_path = NULL WHERE category = ? AND image_path IS NOT NULL", (body.category,))
        db.commit()

    return {"deleted_records": deleted_records, "deleted_images": deleted_images}


@router.get("/{detection_id}/image")
def get_image(detection_id: int, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    row = db.execute("SELECT image_path FROM detections WHERE id = ?", (detection_id,)).fetchone()
    if not row or not row["image_path"]:
        return {"error": "not found"}
    return FileResponse(row["image_path"])
