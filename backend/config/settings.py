from functools import lru_cache
from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

class Settings(BaseSettings):
    app_name: str = "Nomad Eye"
    secret_key: str = "change-me-in-production"
    admin_username: str = "admin"
    admin_password: str = "nomadeye"
    db_path: str = str(BASE_DIR / "data" / "db" / "nomadeye.db")
    images_dir: str = str(BASE_DIR / "data" / "images")
    clips_dir: str = str(BASE_DIR / "data" / "clips")
    detection_confidence: float = 0.5
    motion_threshold: int = 500
    clip_seconds_before: int = 5
    clip_seconds_after: int = 5
    ap_ssid: str = "NomadEye-Setup"
    ap_password: str = "nomadeye123"
    notify_on_reconnect: bool = True

    class Config:
        env_file = ".env"

@lru_cache()
def get_settings() -> Settings:
    return Settings()
