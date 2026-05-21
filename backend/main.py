from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
from api.routes import cameras, detections, notifications, network, settings, auth, status
from config.settings import get_settings

cfg = get_settings()
app = FastAPI(title="Nomad Eye", version="1.0.0")

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
