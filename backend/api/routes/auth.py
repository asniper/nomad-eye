import sqlite3
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from config.settings import get_settings
from models.database import get_db
from security import hash_password, verify_password, generate_session_token

cfg = get_settings()
router = APIRouter()

SESSION_LIFETIME_DAYS = 30
SESSION_RENEW_WITHIN_DAYS = 5  # renew (extend) once fewer than this many days remain
VALID_ROLES = ('admin', 'operator', 'viewer')


class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = 'viewer'


class UserUpdate(BaseModel):
    username: str | None = None
    password: str | None = None
    role: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


def _bearer_token(authorization: str) -> str:
    if not authorization.startswith('Bearer '):
        return ''
    return authorization[len('Bearer '):].strip()


def validate_session_token(db: sqlite3.Connection, token: str) -> dict | None:
    """Shared by the HTTP auth dependency and WebSocket routes (which can't send
    Authorization headers from browser JS, so they pass the token as a query param)."""
    if not token:
        return None

    row = db.execute(
        "SELECT sessions.user_id, sessions.expires_at, users.username, users.role "
        "FROM sessions JOIN users ON users.id = sessions.user_id "
        "WHERE sessions.token = ?", (token,)
    ).fetchone()
    if not row:
        return None

    now = datetime.now(timezone.utc)
    expires_dt = datetime.fromisoformat(row["expires_at"])
    if expires_dt < now:
        db.execute("DELETE FROM sessions WHERE token=?", (token,))
        db.commit()
        return None

    # Sliding renewal — only write when the session is close to expiring, not on every request.
    if (expires_dt - now) < timedelta(days=SESSION_RENEW_WITHIN_DAYS):
        new_expiry = (now + timedelta(days=SESSION_LIFETIME_DAYS)).isoformat()
        db.execute("UPDATE sessions SET expires_at=? WHERE token=?", (new_expiry, token))
        db.commit()

    return {"id": row["user_id"], "username": row["username"], "role": row["role"]}


def require_auth(
    authorization: str = Header(default=''),
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Any authenticated user, regardless of role."""
    user = validate_session_token(db, _bearer_token(authorization))
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


def require_role(*roles: str):
    def _check(user: dict = Depends(require_auth)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return _check


require_admin = require_role('admin')
require_operator = require_role('admin', 'operator')


@router.post("/login")
def login(body: LoginRequest, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT id, password_hash, role FROM users WHERE username=?", (body.username,)
    ).fetchone()
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = generate_session_token()
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(days=SESSION_LIFETIME_DAYS)).isoformat()
    db.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, row["id"], now.isoformat(), expires_at)
    )
    db.execute("UPDATE users SET last_login=? WHERE id=?", (now.isoformat(), row["id"]))
    # Opportunistic cleanup — logins are infrequent enough that this is cheap, and it's
    # the only thing keeping the sessions table from growing forever with dead rows.
    db.execute("DELETE FROM sessions WHERE expires_at < ?", (now.isoformat(),))
    db.commit()
    return {"success": True, "token": token, "id": row["id"], "username": body.username, "role": row["role"]}


@router.post("/logout")
def logout(authorization: str = Header(default=''), db: sqlite3.Connection = Depends(get_db)):
    token = _bearer_token(authorization)
    if token:
        db.execute("DELETE FROM sessions WHERE token=?", (token,))
        db.commit()
    return {"success": True}


@router.get("/me")
def me(user: dict = Depends(require_auth)):
    return user


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    user: dict = Depends(require_auth),
    db: sqlite3.Connection = Depends(get_db),
):
    """Any authenticated user can change their own password."""
    row = db.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()
    if not row or not verify_password(body.current_password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if not body.new_password or len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    db.execute(
        "UPDATE users SET password_hash=? WHERE id=?",
        (hash_password(body.new_password), user["id"])
    )
    # Invalidate every session for this user, including the one making this request —
    # otherwise a stolen token survives its own victim "fixing" it by changing the
    # password. The frontend already logs the user out right after a successful change.
    db.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
    db.commit()
    return {"success": True}


# ---------------------------------------------------------------------------
# User management (admin only) — full CRUD
# ---------------------------------------------------------------------------

@router.get("/users")
def list_users(_: dict = Depends(require_admin), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        "SELECT id, username, role, created_at, last_login FROM users ORDER BY username"
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/users")
def create_user(
    body: UserCreate,
    _: dict = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {VALID_ROLES}")
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="username is required")
    if not body.password or len(body.password) < 8:
        raise HTTPException(status_code=400, detail="password must be at least 8 characters")

    existing = db.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    cur = db.execute(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, datetime('now'))",
        (username, hash_password(body.password), body.role)
    )
    db.commit()
    return {"id": cur.lastrowid, "username": username, "role": body.role}


@router.patch("/users/{user_id}")
def update_user(
    user_id: int,
    body: UserUpdate,
    current: dict = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    # BEGIN IMMEDIATE grabs the write lock up front, serializing this whole
    # check-then-act sequence against any other concurrent admin write — otherwise
    # two concurrent requests demoting two different admins could both read
    # admin_count=2 before either commits, leaving zero admins.
    db.execute("BEGIN IMMEDIATE")
    row = db.execute("SELECT id, role FROM users WHERE id=?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    if body.role is not None and body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {VALID_ROLES}")

    # Prevent demoting the last remaining admin — would lock everyone out of admin access.
    if body.role is not None and body.role != 'admin' and row["role"] == 'admin':
        admin_count = db.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the last remaining admin")

    if body.username is not None:
        username = body.username.strip()
        if not username:
            raise HTTPException(status_code=400, detail="username cannot be empty")
        dup = db.execute("SELECT 1 FROM users WHERE username=? AND id!=?", (username, user_id)).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="Username already exists")
        db.execute("UPDATE users SET username=? WHERE id=?", (username, user_id))

    if body.role is not None:
        db.execute("UPDATE users SET role=? WHERE id=?", (body.role, user_id))

    if body.password is not None:
        if len(body.password) < 8:
            raise HTTPException(status_code=400, detail="password must be at least 8 characters")
        db.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(body.password), user_id))
        # Resetting a password invalidates that user's existing sessions.
        db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))

    db.commit()
    updated = db.execute(
        "SELECT id, username, role, created_at, last_login FROM users WHERE id=?", (user_id,)
    ).fetchone()
    return dict(updated)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    current: dict = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    # See update_user's BEGIN IMMEDIATE comment — same race, same fix.
    db.execute("BEGIN IMMEDIATE")
    row = db.execute("SELECT role FROM users WHERE id=?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    if user_id == current["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account while logged in as it")
    if row["role"] == 'admin':
        admin_count = db.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last remaining admin")
    db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
    db.execute("DELETE FROM users WHERE id=?", (user_id,))
    db.commit()
    return {"success": True}
