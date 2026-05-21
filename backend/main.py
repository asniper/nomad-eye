import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from models.database import init_db
from detection.pipeline import DetectionPipeline
from networking.manager import auto_connect_loop
from api.routes import cameras as cam_router
from api.routes import cameras, detections, notifications, network, settings, auth, status


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()

    pipeline = DetectionPipeline([])
    pipeline.start()
    cam_router.set_pipeline(pipeline)

    # Discover cameras on startup
    await cam_router.scan_and_refresh()

    asyncio.create_task(auto_connect_loop())

    yield

    pipeline.stop()
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

STATIC_DIR = Path(__file__).parent / "static"

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        return FileResponse(STATIC_DIR / "index.html")
