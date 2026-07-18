import base64
import os
import shutil
import numpy as np
import cv2
from datetime import datetime, time as dtime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from models.database import get_db
from api.routes.auth import require_auth, require_operator, require_auth_flexible
from config.settings import get_settings
from storage.manager import get_active_images_dir, get_active_clips_dir
from detection.continuous_recorder import SEGMENT_DURATION_SECS
import sqlite3

router = APIRouter()
cfg = get_settings()

_pipeline = None


def set_pipeline(pipeline):
    global _pipeline
    _pipeline = pipeline


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
def purge_detections(body: PurgeBody, db: sqlite3.Connection = Depends(get_db), _=Depends(require_operator)):
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
def delete_event(event_id: str, db: sqlite3.Connection = Depends(get_db), _=Depends(require_operator)):
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
def purge_all_clips(db: sqlite3.Connection = Depends(get_db), _=Depends(require_operator)):
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
def get_clip(event_id: str, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth_flexible)):
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
def delete_clip(event_id: str, db: sqlite3.Connection = Depends(get_db), _=Depends(require_operator)):
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


def _backfill_missing_sizes(db: sqlite3.Connection, camera_id: int = None):
    """size_bytes is populated at insert time for every new segment (see
    pipeline.py's _store_continuous_segment) — this only covers rows written
    before that column existed, stat()-ing each one exactly once and caching
    the result so it's never re-stat()'d again."""
    query = "SELECT id, path FROM continuous_segments WHERE size_bytes IS NULL"
    params = ()
    if camera_id is not None:
        query += " AND camera_id=?"
        params = (camera_id,)
    missing = db.execute(query, params).fetchall()
    for r in missing:
        if r["path"]:
            try:
                size = Path(r["path"]).stat().st_size
                db.execute("UPDATE continuous_segments SET size_bytes=? WHERE id=?", (size, r["id"]))
            except OSError:
                pass
    if missing:
        db.commit()


@router.get("/continuous/storage")
def get_continuous_storage(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    _backfill_missing_sizes(db)
    agg = db.execute("SELECT COUNT(*), SUM(size_bytes) FROM continuous_segments").fetchone()
    return {"segment_count": agg[0] or 0, "segment_bytes": agg[1] or 0}


@router.get("/continuous")
def list_continuous_segments(
    camera_id: int = Query(...),
    date: str = Query(..., description="Calendar day 'YYYY-MM-DD' in `tz`"),
    tz: str = Query('UTC'),
    db: sqlite3.Connection = Depends(get_db),
    _=Depends(require_auth),
):
    try:
        zone = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        zone = timezone.utc
    try:
        day = datetime.strptime(date, '%Y-%m-%d').date()
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be 'YYYY-MM-DD'")
    start_local = datetime.combine(day, dtime.min, tzinfo=zone)
    end_local = start_local + timedelta(days=1)
    # Plain string comparison, not SQLite's datetime() — both bounds and every
    # `started_at` row are always Python .isoformat() UTC strings with the same
    # '+00:00' suffix convention, so lexicographic comparison already sorts them
    # correctly with no parsing needed. datetime() would actually be *less*
    # reliable here: SQLite only gained support for parsing a numeric timezone
    # suffix like '+00:00' in 3.42 (2023) — on an older bundled libsqlite3 (still
    # common on Debian/Raspberry Pi OS at the time of writing) it returns NULL
    # for both sides, silently making this query return nothing at all.
    start_iso = start_local.astimezone(timezone.utc).isoformat()
    end_iso = end_local.astimezone(timezone.utc).isoformat()
    rows = db.execute(
        "SELECT id, camera_id, started_at, locked, description FROM continuous_segments WHERE camera_id=? "
        "AND started_at >= ? AND started_at < ? "
        "ORDER BY started_at ASC LIMIT 500",
        (camera_id, start_iso, end_iso)
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/continuous/summary")
def continuous_summary(camera_id: int = Query(...), db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    _backfill_missing_sizes(db, camera_id)
    agg = db.execute(
        "SELECT COUNT(*), SUM(size_bytes), MIN(started_at), MAX(started_at) FROM continuous_segments WHERE camera_id=?",
        (camera_id,)
    ).fetchone()
    return {
        "segment_count": agg[0] or 0,
        "total_bytes": agg[1] or 0,
        "oldest_started_at": agg[2],
        "newest_started_at": agg[3],
    }


@router.get("/continuous/find")
def find_continuous_segment(
    camera_id: int = Query(...),
    at: str = Query(..., description="Target moment, ISO 8601"),
    db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth),
):
    """Finds the continuous-recording segment covering a specific moment, if one
    still exists. Segments are fixed 5-minute, non-overlapping, sequential
    windows per camera, so the right one — if any — is simply the last one that
    started at or before the target time. A gap bigger than one segment's span
    means recording wasn't actually running through that moment (camera was
    off, continuous recording was disabled, or the segment has since been
    purged) even though an earlier row still exists."""
    try:
        target = datetime.fromisoformat(at)
        if target.tzinfo is None:
            target = target.replace(tzinfo=timezone.utc)
        target = target.astimezone(timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail="'at' must be ISO 8601")

    row = db.execute(
        "SELECT id, started_at, locked, description FROM continuous_segments WHERE camera_id=? AND started_at <= ? "
        "ORDER BY started_at DESC LIMIT 1",
        (camera_id, target.isoformat())
    ).fetchone()
    if not row:
        return {"found": False}

    started_at = datetime.fromisoformat(row["started_at"])
    gap = (target - started_at).total_seconds()
    if gap > SEGMENT_DURATION_SECS + 30:
        return {"found": False}

    return {
        "found": True,
        "segment_id": row["id"],
        "started_at": row["started_at"],
        "locked": bool(row["locked"]),
        "description": row["description"],
        "offset_seconds": max(0, gap),
    }


@router.get("/continuous/locked")
def list_locked_continuous_segments(
    camera_id: int = Query(...),
    db: sqlite3.Connection = Depends(get_db),
    _=Depends(require_auth),
):
    """All locked segments for a camera, regardless of day — locking is meant to
    survive across the day-by-day timeline, so finding one shouldn't require
    paging back through calendar days to spot it."""
    rows = db.execute(
        "SELECT id, camera_id, started_at, locked, description FROM continuous_segments "
        "WHERE camera_id=? AND locked=1 ORDER BY started_at DESC LIMIT 200",
        (camera_id,)
    ).fetchall()
    return [dict(r) for r in rows]


class LockBody(BaseModel):
    locked: bool


@router.post("/continuous/{segment_id}/lock")
def lock_continuous_segment(
    segment_id: int, body: LockBody,
    db: sqlite3.Connection = Depends(get_db), _=Depends(require_operator),
):
    cur = db.execute(
        "UPDATE continuous_segments SET locked=? WHERE id=?",
        (1 if body.locked else 0, segment_id)
    )
    db.commit()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Segment not found")
    return {"id": segment_id, "locked": body.locked}


class DescriptionBody(BaseModel):
    description: str


@router.patch("/continuous/{segment_id}/description")
def set_continuous_description(
    segment_id: int, body: DescriptionBody,
    db: sqlite3.Connection = Depends(get_db), _=Depends(require_operator),
):
    text = body.description.strip()[:500]
    cur = db.execute(
        "UPDATE continuous_segments SET description=? WHERE id=?",
        (text or None, segment_id)
    )
    db.commit()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Segment not found")
    return {"id": segment_id, "description": text}


class ReanalyzeBody(BaseModel):
    image_base64: str  # data URL or raw base64 JPEG/PNG of a single frame
    bbox: list[int]     # [x1, y1, x2, y2] in that frame's pixel coordinates
    label: str          # what the user says is actually in the box, e.g. "bear"


@router.post("/continuous/{segment_id}/reanalyze")
def reanalyze_continuous_segment(segment_id: int, body: ReanalyzeBody, _=Depends(require_operator)):
    """Manual diagnostic re-run against a single frame the user pulled from a
    locked recording: reports what the currently active model actually scored
    near the drawn box, on the full frame and on a cropped+upscaled version.
    segment_id isn't touched here — it just scopes the action in the URL for
    consistency with the rest of the continuous-recording API."""
    if _pipeline is None:
        raise HTTPException(status_code=503, detail="Detection pipeline not running")
    if len(body.bbox) != 4:
        raise HTTPException(status_code=400, detail="bbox must be [x1, y1, x2, y2]")
    if not body.label.strip():
        raise HTTPException(status_code=400, detail="label is required")

    raw = body.image_base64.split(',', 1)[-1]  # strip a data: URL prefix if present
    try:
        img_bytes = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="image_base64 could not be decoded")
    frame = cv2.imdecode(np.frombuffer(img_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="image_base64 is not a valid image")

    result = _pipeline.reanalyze_frame(frame, tuple(body.bbox), body.label.strip())
    if "error" in result:
        raise HTTPException(status_code=503, detail=result["error"])
    return result


@router.get("/continuous/{segment_id}/video")
def get_continuous_video(segment_id: int, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth_flexible)):
    row = db.execute("SELECT path FROM continuous_segments WHERE id=?", (segment_id,)).fetchone()
    if not row or not row["path"]:
        raise HTTPException(status_code=404, detail="Segment not found")
    p = Path(row["path"])
    if not p.exists():
        raise HTTPException(status_code=404, detail="Segment file not found on disk")
    return FileResponse(str(p), media_type="video/mp4", filename=f"segment-{segment_id}.mp4")


@router.delete("/continuous/{segment_id}")
def delete_continuous_segment(segment_id: int, db: sqlite3.Connection = Depends(get_db), _=Depends(require_operator)):
    row = db.execute("SELECT path FROM continuous_segments WHERE id=?", (segment_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Segment not found")
    db.execute("DELETE FROM continuous_segments WHERE id=?", (segment_id,))
    db.commit()
    if row["path"]:
        try:
            os.remove(row["path"])
        except OSError:
            pass
    return {"deleted": segment_id}


@router.get("/{detection_id}/image")
def get_image(detection_id: int, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    row = db.execute("SELECT image_path FROM detections WHERE id = ?", (detection_id,)).fetchone()
    if not row or not row["image_path"]:
        return {"error": "not found"}
    return FileResponse(row["image_path"])
