import os
import shutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from models.database import get_db
from api.routes.auth import require_auth
from config.settings import get_settings
from storage.manager import get_active_images_dir, get_active_clips_dir
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
            d.event_id,
            d.category,
            d.label,
            d.camera_id,
            MIN(d.timestamp) as first_seen,
            MAX(d.timestamp) as last_seen,
            COUNT(*) as screenshot_count,
            GROUP_CONCAT(d.id) as detection_ids,
            CASE WHEN ec.event_id IS NOT NULL THEN 1 ELSE 0 END as has_clip
        FROM detections d
        LEFT JOIN event_clips ec ON d.event_id = ec.event_id
        WHERE d.event_id IS NOT NULL
    """
    params = []
    if camera_id is not None:
        query += " AND d.camera_id = ?"
        params.append(camera_id)
    if category:
        query += " AND d.category = ?"
        params.append(category)
    if label:
        query += " AND d.label = ?"
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

    query += " GROUP BY d.event_id ORDER BY MAX(d.timestamp) DESC LIMIT ? OFFSET ?"
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
        SELECT d.event_id, d.category, d.label, d.camera_id,
               MIN(d.timestamp) as first_seen, MAX(d.timestamp) as last_seen,
               COUNT(*) as screenshot_count,
               CASE WHEN ec.event_id IS NOT NULL THEN 1 ELSE 0 END as has_clip
        FROM detections d
        LEFT JOIN event_clips ec ON d.event_id = ec.event_id
        WHERE d.event_id = ?
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

    # When purging all records, also delete all clips
    if not body.images_only and body.category == "all":
        clip_rows = db.execute("SELECT clip_path FROM event_clips").fetchall()
        db.execute("DELETE FROM event_clips")
        db.commit()
        for r in clip_rows:
            if r["clip_path"]:
                try:
                    os.remove(r["clip_path"])
                except OSError:
                    pass

    return {"deleted_records": deleted_records, "deleted_images": deleted_images}


@router.delete("/events/{event_id}")
def delete_event(event_id: str, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    targeted = db.execute(
        "SELECT DISTINCT image_path FROM detections WHERE event_id = ? AND image_path IS NOT NULL",
        (event_id,)
    ).fetchall()
    targeted_paths = {r["image_path"] for r in targeted}

    # Also collect clip path before deleting
    clip_row = db.execute(
        "SELECT clip_path FROM event_clips WHERE event_id = ?", (event_id,)
    ).fetchone()

    db.execute("DELETE FROM detections WHERE event_id = ?", (event_id,))
    db.execute("DELETE FROM event_clips WHERE event_id = ?", (event_id,))
    db.commit()

    still_referenced = {
        r["image_path"]
        for r in db.execute("SELECT DISTINCT image_path FROM detections WHERE image_path IS NOT NULL").fetchall()
    }
    for path in targeted_paths:
        if path not in still_referenced:
            try:
                os.remove(path)
            except OSError:
                pass

    if clip_row and clip_row["clip_path"]:
        try:
            os.remove(clip_row["clip_path"])
        except OSError:
            pass

    return {"deleted": event_id}


@router.get("/clips/storage")
def get_clips_storage(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    import shutil as _shutil
    rows = db.execute("SELECT clip_path FROM event_clips").fetchall()
    clip_count = len(rows)
    clip_bytes = 0
    for r in rows:
        if r["clip_path"]:
            try:
                clip_bytes += Path(r["clip_path"]).stat().st_size
            except OSError:
                pass
    clips_dir = get_active_clips_dir()
    disk_total = disk_used = disk_free = 0
    if clips_dir:
        try:
            du = _shutil.disk_usage(clips_dir)
            disk_total, disk_used, disk_free = du.total, du.used, du.free
        except Exception:
            pass
    return {
        "clip_count": clip_count,
        "clip_bytes": clip_bytes,
        "clips_dir": clips_dir,
        "disk_total": disk_total,
        "disk_used": disk_used,
        "disk_free": disk_free,
    }


@router.delete("/clips")
def purge_all_clips(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    rows = db.execute("SELECT clip_path FROM event_clips").fetchall()
    db.execute("DELETE FROM event_clips")
    db.commit()
    deleted = 0
    for r in rows:
        if r["clip_path"]:
            try:
                os.remove(r["clip_path"])
                deleted += 1
            except OSError:
                pass
    return {"deleted_clips": deleted}


@router.get("/events/{event_id}/clip")
def get_clip(event_id: str, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    row = db.execute(
        "SELECT clip_path FROM event_clips WHERE event_id = ?", (event_id,)
    ).fetchone()
    if not row or not row["clip_path"]:
        raise HTTPException(status_code=404, detail="No clip for this event")
    p = Path(row["clip_path"])
    if not p.exists():
        raise HTTPException(status_code=404, detail="Clip file not found on disk")
    return FileResponse(str(p), media_type="video/mp4", filename=f"clip-{event_id}.mp4")


@router.delete("/events/{event_id}/clip")
def delete_clip(event_id: str, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    row = db.execute(
        "SELECT clip_path FROM event_clips WHERE event_id = ?", (event_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No clip for this event")
    db.execute("DELETE FROM event_clips WHERE event_id = ?", (event_id,))
    db.commit()
    if row["clip_path"]:
        try:
            os.remove(row["clip_path"])
        except OSError:
            pass
    return {"deleted": event_id}


@router.get("/{detection_id}/image")
def get_image(detection_id: int, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    row = db.execute("SELECT image_path FROM detections WHERE id = ?", (detection_id,)).fetchone()
    if not row or not row["image_path"]:
        return {"error": "not found"}
    return FileResponse(row["image_path"])
