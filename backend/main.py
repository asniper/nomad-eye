import os
# Limit BLAS threads used by dlib (via OpenBLAS) to prevent spin-wait thread explosion.
# OMP_NUM_THREADS is intentionally NOT limited here — PyTorch needs multiple OMP threads
# for YOLO inference speed. Only the BLAS layer (used by dlib) is capped.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("BLIS_NUM_THREADS", "1")

# The sudoers entry expects storage-helper.sh at the repo root, but it lives in deploy/.
# Create the symlink if it's missing — arduino owns /opt/nomad-eye/ so no sudo needed.
_helper_src = '/opt/nomad-eye/deploy/storage-helper.sh'
_helper_dst = '/opt/nomad-eye/storage-helper.sh'
if os.path.exists(_helper_src) and not os.path.lexists(_helper_dst):
    try:
        os.symlink(_helper_src, _helper_dst)
    except OSError:
        pass

import asyncio
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from config.settings import get_settings as get_app_settings
from models.database import init_db
from detection.pipeline import DetectionPipeline
from notifications.queue import QueueProcessor
from api.routes import cameras as cam_router
from api.routes import cameras, detections, notifications, network, settings, auth, status, captive, setup
from api.routes import storage
from api.routes import system
from api.routes.system import start_auto_update_scheduler
from api.routes import faces as faces_router
from api.routes import faces
from api.routes import presence as presence_router
from storage.manager import auto_mount_primary
from detection.presence import PresenceScanner


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()

    _cfg = get_app_settings()
    db = sqlite3.connect(_cfg.db_path)
    det_row = db.execute("SELECT value FROM app_config WHERE key='detection_model'").fetchone()
    yolo_row = db.execute("SELECT value FROM app_config WHERE key='yolo_model'").fetchone()
    if det_row:
        initial_model = det_row[0]
    elif yolo_row:
        initial_model = f"{yolo_row[0]}.pt"
    else:
        initial_model = 'yolov8n'
    default_conf = _cfg.detection_confidence
    conf_rows = db.execute(
        "SELECT key, value FROM app_config WHERE key IN ('confidence_people','confidence_vehicles','confidence_animals','confidence_other')"
    ).fetchall()
    initial_confidences = {r[0].replace('confidence_', ''): float(r[1]) for r in conf_rows}
    face_conf_row = db.execute("SELECT value FROM app_config WHERE key='confidence_faces'").fetchone()
    initial_face_confidence = float(face_conf_row[0]) if face_conf_row else 0.0
    enabled_rows = db.execute(
        "SELECT key, value FROM app_config WHERE key LIKE 'category_enabled_%'"
    ).fetchall()
    face_cam_rows = db.execute(
        "SELECT camera_id, face_detection_enabled, face_sensitivity FROM cameras WHERE deleted=0"
    ).fetchall()
    ai_row = db.execute("SELECT value FROM app_config WHERE key='ai_enabled'").fetchone()
    initial_ai_enabled = (ai_row[0] != '0') if ai_row else True
    quality_rows = db.execute(
        "SELECT key, value FROM app_config WHERE key IN ('video_width','video_height','video_fps')"
    ).fetchall()
    qkv = {r[0]: r[1] for r in quality_rows}
    motion_row = db.execute("SELECT value FROM app_config WHERE key='motion_threshold'").fetchone()
    initial_motion_threshold = int(motion_row[0]) if motion_row else None
    motion_scale_row = db.execute("SELECT value FROM app_config WHERE key='motion_scale'").fetchone()
    detection_cooldown_row = db.execute("SELECT value FROM app_config WHERE key='detection_cooldown'").fetchone()
    classes_row = db.execute("SELECT value FROM app_config WHERE key='detection_classes'").fetchone()
    clips_enabled_row = db.execute("SELECT value FROM app_config WHERE key='clips_enabled'").fetchone()
    clips_pre_roll_row = db.execute("SELECT value FROM app_config WHERE key='clips_pre_roll'").fetchone()
    clips_post_roll_row = db.execute("SELECT value FROM app_config WHERE key='clips_post_roll'").fetchone()
    db.close()

    from api.routes.settings import _parse_classes
    initial_classes = _parse_classes(classes_row[0] if classes_row else None)

    # If only face detection is enabled, skip loading the YOLO model entirely —
    # it's never used in faces-only mode and loading YOLOWorld takes 2+ minutes.
    enabled_cats = {r[0][len('category_enabled_'):] for r in enabled_rows if r[1] != '0'}
    yolo_needed = bool(enabled_cats - {'faces'})
    effective_model = initial_model if yolo_needed else 'yolov8n'

    pipeline = DetectionPipeline([], model_name=effective_model,
                                 confidences=initial_confidences if initial_confidences else None,
                                 classes=initial_classes)
    pipeline.set_face_confidence(initial_face_confidence)
    if initial_motion_threshold is not None:
        pipeline.set_motion_threshold(initial_motion_threshold)
    if motion_scale_row:
        try:
            pipeline.set_motion_scale(float(motion_scale_row[0]))
        except ValueError:
            pass
    if detection_cooldown_row:
        try:
            pipeline.set_detection_cooldown(float(detection_cooldown_row[0]))
        except ValueError:
            pass
    for row in enabled_rows:
        category = row[0][len('category_enabled_'):]
        if row[1] == '0':
            pipeline.set_category_enabled(category, False)
    pipeline.set_ai_enabled(initial_ai_enabled)
    for row in face_cam_rows:
        cid = row[0]
        if row[1] is not None and not row[1]:
            pipeline.set_camera_face_enabled(cid, False)
        if row[2]:
            pipeline.set_camera_face_sensitivity(cid, row[2])
    try:
        pipeline.set_video_quality(
            int(qkv.get('video_width', 1280)),
            int(qkv.get('video_height', 720)),
            int(qkv.get('video_fps', 15)),
        )
    except (ValueError, KeyError):
        pass
    pipeline.start()
    pipeline.set_clips_config(
        enabled=(clips_enabled_row[0] if clips_enabled_row else '0') != '0',
        pre_roll=int(clips_pre_roll_row[0]) if clips_pre_roll_row else 5,
        post_roll=int(clips_post_roll_row[0]) if clips_post_roll_row else 10,
    )
    cam_router.set_pipeline(pipeline)
    settings.set_pipeline(pipeline)
    faces_router.set_pipeline(pipeline)

    queue_proc = QueueProcessor()
    queue_proc.start()

    presence_scanner = PresenceScanner()
    presence_scanner.start()
    presence_router.set_scanner(presence_scanner)

    # Mount primary external storage device if configured
    auto_mount_primary()

    start_auto_update_scheduler()

    # Discover cameras on startup
    await cam_router.scan_and_refresh()

    async def _auto_scan_loop():
        while True:
            await asyncio.sleep(30)
            try:
                await cam_router.scan_and_refresh()
            except Exception:
                pass

    scan_task = asyncio.create_task(_auto_scan_loop())

    yield

    scan_task.cancel()
    pipeline.stop()
    queue_proc.stop()
    presence_scanner.stop()
    for cap in list(pipeline._cameras):
        cap.stop()


app = FastAPI(title="Nomad Eye", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(cameras.router, prefix="/api/cameras", tags=["cameras"])
app.include_router(detections.router, prefix="/api/detections", tags=["detections"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["notifications"])
app.include_router(network.router, prefix="/api/network", tags=["network"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
app.include_router(status.router, prefix="/api/status", tags=["status"])
app.include_router(captive.router)
app.include_router(setup.router, prefix="/api/setup", tags=["setup"])
app.include_router(storage.router, prefix="/api/storage", tags=["storage"])
app.include_router(system.router, prefix="/api/system", tags=["system"])
app.include_router(faces.router, prefix="/api/faces", tags=["faces"])
app.include_router(presence_router.router, prefix="/api/presence", tags=["presence"])

@app.get("/api/health")
def health():
    return {"ok": True}


STATIC_DIR = Path(__file__).parent / "static"

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        return FileResponse(STATIC_DIR / "index.html")
