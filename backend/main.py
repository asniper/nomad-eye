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
from api.routes import faces as faces_router
from api.routes import faces
from storage.manager import auto_mount_primary


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()

    _cfg = get_app_settings()
    db = sqlite3.connect(_cfg.db_path)
    row = db.execute("SELECT value FROM app_config WHERE key='yolo_model'").fetchone()
    initial_model = f"{row[0]}.pt" if row else "yolov8n.pt"
    default_conf = _cfg.detection_confidence
    conf_rows = db.execute(
        "SELECT key, value FROM app_config WHERE key IN ('confidence_people','confidence_vehicles','confidence_animals','confidence_other')"
    ).fetchall()
    initial_confidences = {r[0].replace('confidence_', ''): float(r[1]) for r in conf_rows}
    db.close()

    pipeline = DetectionPipeline([], model_name=initial_model,
                                 confidences=initial_confidences if initial_confidences else None)
    pipeline.start()
    cam_router.set_pipeline(pipeline)
    settings.set_pipeline(pipeline)
    faces_router.set_pipeline(pipeline)

    queue_proc = QueueProcessor()
    queue_proc.start()

    # Mount primary external storage device if configured
    auto_mount_primary()

    # Discover cameras on startup
    await cam_router.scan_and_refresh()

    yield

    pipeline.stop()
    queue_proc.stop()
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

STATIC_DIR = Path(__file__).parent / "static"

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        return FileResponse(STATIC_DIR / "index.html")
