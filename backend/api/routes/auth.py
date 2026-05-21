from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel
import secrets
from config.settings import get_settings

cfg = get_settings()
router = APIRouter()
security = HTTPBasic()

class LoginRequest(BaseModel):
    username: str
    password: str

def require_auth(credentials: HTTPBasicCredentials = Depends(security)):
    ok = (
        secrets.compare_digest(credentials.username, cfg.admin_username) and
        secrets.compare_digest(credentials.password, cfg.admin_password)
    )
    if not ok:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return credentials.username

@router.post("/login")
def login(body: LoginRequest):
    ok = (
        secrets.compare_digest(body.username, cfg.admin_username) and
        secrets.compare_digest(body.password, cfg.admin_password)
    )
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"success": True, "username": body.username}
