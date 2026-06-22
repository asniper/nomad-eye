import os
import secrets
import sqlite3
import subprocess
import threading
import time
import psutil
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from api.routes.auth import require_auth
from config.settings import get_settings

router = APIRouter()

REPO_OWNER = 'asniper'
REPO_NAME = 'nomad-eye'
PROJECT_PATH = '/opt/nomad-eye'

_update_lock = threading.Lock()
_update_status = {"in_progress": False, "last_result": None}


def _db_get(key: str, default: str = None) -> str:
    cfg = get_settings()
    try:
        db = sqlite3.connect(cfg.db_path, timeout=5)
        row = db.execute("SELECT value FROM app_config WHERE key=?", (key,)).fetchone()
        db.close()
        return row[0] if row else default
    except Exception:
        return default


def _db_set(key: str, value: str):
    cfg = get_settings()
    try:
        db = sqlite3.connect(cfg.db_path, timeout=5)
        db.execute("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", (key, value))
        db.commit()
        db.close()
    except Exception:
        pass


def _git(*args) -> str:
    return subprocess.check_output(
        ['git', '-C', PROJECT_PATH, *args],
        stderr=subprocess.DEVNULL, text=True
    ).strip()


def _current_version():
    try:
        sha = _git('rev-parse', '--short', 'HEAD')
    except Exception:
        return 'unknown', 'unknown', None
    try:
        tag = _git('describe', '--tags', '--exact-match', 'HEAD')
    except Exception:
        tag = None
    try:
        last_updated = _git('log', '-1', '--format=%cI')
    except Exception:
        last_updated = None
    return tag or sha, sha, last_updated


def _fetch_latest_release():
    """Get latest release tag via git ls-remote — works for private repos."""
    try:
        out = subprocess.check_output(
            ['git', '-C', PROJECT_PATH, 'ls-remote', '--tags', '--sort=v:refname', 'origin'],
            stderr=subprocess.DEVNULL, text=True, timeout=15,
        )
        tags = []
        for line in out.splitlines():
            parts = line.split('\t')
            if len(parts) == 2 and parts[1].startswith('refs/tags/') and not parts[1].endswith('^{}'):
                tags.append(parts[1][len('refs/tags/'):])
        return (tags[-1], None) if tags else (None, None)
    except Exception:
        return None, None


def _fetch_latest_main():
    """Get latest commit SHA on main via git ls-remote."""
    try:
        out = subprocess.check_output(
            ['git', '-C', PROJECT_PATH, 'ls-remote', 'origin', 'main'],
            stderr=subprocess.DEVNULL, text=True, timeout=15,
        )
        sha = out.split()[0][:7] if out.strip() else None
        return sha, None
    except Exception:
        return None, None


def perform_update(channel: str):
    global _update_status
    if not _update_lock.acquire(blocking=False):
        return
    _update_status = {"in_progress": True, "last_result": None}
    try:
        if channel == 'main':
            subprocess.run(['git', '-C', PROJECT_PATH, 'fetch', 'origin', 'main'], check=True, timeout=60)
            subprocess.run(['git', '-C', PROJECT_PATH, 'reset', '--hard', 'origin/main'], check=True, timeout=30)
        else:
            tag, _ = _fetch_latest_release()
            if not tag:
                _update_status = {"in_progress": False, "last_result": "no_release"}
                return
            subprocess.run(['git', '-C', PROJECT_PATH, 'fetch', '--tags'], check=True, timeout=60)
            subprocess.run(['git', '-C', PROJECT_PATH, 'checkout', tag], check=True, timeout=30)
        subprocess.run(
            ['bash', '-c', f'cd {PROJECT_PATH}/frontend && npm install --prefer-offline && npm run build'],
            check=True, timeout=300, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        _update_status = {"in_progress": False, "last_result": "success"}
    except Exception as e:
        _update_status = {"in_progress": False, "last_result": f"error: {e}"}
        return
    finally:
        _update_lock.release()
    time.sleep(2)
    subprocess.Popen(
        ['/usr/bin/sudo', '/opt/nomad-eye/storage-helper.sh', 'restart'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def start_auto_update_scheduler():
    def _loop():
        while True:
            now = time.localtime()
            secs_until_3am = ((3 - now.tm_hour) % 24) * 3600 - now.tm_min * 60 - now.tm_sec
            if secs_until_3am <= 0:
                secs_until_3am += 86400
            time.sleep(secs_until_3am)
            if _db_get('auto_update_enabled', '0') == '1':
                channel = _db_get('update_channel', 'releases')
                perform_update(channel)

    t = threading.Thread(target=_loop, daemon=True, name='auto-update-scheduler')
    t.start()


@router.get("/stats")
def system_stats(_=Depends(require_auth)):
    cpu = psutil.cpu_percent(interval=0.5)
    mem = psutil.virtual_memory()
    with open('/proc/uptime') as f:
        uptime_secs = int(float(f.read().split()[0]))
    service_uptime_secs = int(time.time() - psutil.Process(os.getpid()).create_time())

    disks = []
    for part in psutil.disk_partitions(all=False):
        try:
            usage = psutil.disk_usage(part.mountpoint)
            disks.append({
                "device": part.device,
                "mountpoint": part.mountpoint,
                "fstype": part.fstype,
                "total": usage.total,
                "used": usage.used,
                "free": usage.free,
                "percent": usage.percent,
            })
        except PermissionError:
            pass

    return {
        "cpu_percent": cpu,
        "cpu_count": psutil.cpu_count(),
        "memory_total": mem.total,
        "memory_used": mem.used,
        "memory_available": mem.available,
        "memory_percent": mem.percent,
        "uptime_seconds": uptime_secs,
        "service_uptime_seconds": service_uptime_secs,
        "disks": disks,
        "load_avg": list(psutil.getloadavg()),
    }


@router.post("/restart")
def restart_service(_=Depends(require_auth)):
    def _do_restart():
        time.sleep(1.0)
        subprocess.Popen(
            ["/usr/bin/sudo", "/opt/nomad-eye/storage-helper.sh", "restart"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    threading.Thread(target=_do_restart, daemon=True).start()
    return {"restarting": True}


@router.post("/reboot")
def reboot_system(_=Depends(require_auth)):
    def _do_reboot():
        time.sleep(1.0)
        subprocess.Popen(
            ["/usr/bin/sudo", "/opt/nomad-eye/storage-helper.sh", "reboot"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    threading.Thread(target=_do_reboot, daemon=True).start()
    return {"rebooting": True}


@router.get("/update-status")
def update_status_endpoint(_=Depends(require_auth)):
    version, sha, last_updated = _current_version()
    channel = _db_get('update_channel', 'releases')
    auto_update = _db_get('auto_update_enabled', '0') == '1'

    if channel == 'main':
        latest_version, release_date = _fetch_latest_main()
        update_available = bool(latest_version and latest_version != sha)
    else:
        latest_version, release_date = _fetch_latest_release()
        try:
            current_tag = _git('describe', '--tags', '--exact-match', 'HEAD')
        except Exception:
            current_tag = None
        update_available = bool(latest_version and latest_version != current_tag)

    return {
        "current_version": version,
        "current_sha": sha,
        "last_updated": last_updated,
        "channel": channel,
        "auto_update_enabled": auto_update,
        "latest_version": latest_version,
        "release_date": release_date,
        "update_available": update_available,
        "update_in_progress": _update_status["in_progress"],
        "last_result": _update_status["last_result"],
    }


@router.post("/update")
def trigger_update(background_tasks: BackgroundTasks, _=Depends(require_auth)):
    if _update_status["in_progress"]:
        raise HTTPException(status_code=409, detail="Update already in progress")
    channel = _db_get('update_channel', 'releases')
    background_tasks.add_task(perform_update, channel)
    return {"updating": True, "channel": channel}


@router.post("/change-password")
def change_password(body: dict, _=Depends(require_auth)):
    current = body.get('current_password', '')
    new_pw = body.get('new_password', '')
    if not new_pw or len(new_pw) < 4:
        raise HTTPException(status_code=400, detail='New password must be at least 4 characters')
    from api.routes.auth import _get_admin_password
    if not secrets.compare_digest(current, _get_admin_password()):
        raise HTTPException(status_code=401, detail='Current password is incorrect')
    _db_set('admin_password', new_pw)
    return {"changed": True}


@router.post("/update-settings")
def save_update_settings(body: dict, _=Depends(require_auth)):
    if 'channel' in body:
        if body['channel'] not in ('releases', 'main'):
            raise HTTPException(status_code=400, detail="channel must be 'releases' or 'main'")
        _db_set('update_channel', body['channel'])
    if 'auto_update_enabled' in body:
        _db_set('auto_update_enabled', '1' if body['auto_update_enabled'] else '0')
    return {"saved": True}
