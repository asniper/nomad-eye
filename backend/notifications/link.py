import socket
import sqlite3
import subprocess
from config.settings import get_settings

cfg = get_settings()


def _local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return socket.gethostname()


def _tailscale_ip() -> str | None:
    try:
        result = subprocess.run(
            ['tailscale', 'ip', '-4'],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            ip = result.stdout.strip()
            if ip:
                return ip
    except Exception:
        pass
    return None


def get_notification_base_url(db: sqlite3.Connection) -> str:
    rows = db.execute(
        "SELECT key, value FROM app_config WHERE key IN "
        "('notification_link_mode', 'notification_hostname')"
    ).fetchall()
    vals = {r['key']: r['value'] for r in rows}

    mode = vals.get('notification_link_mode') or 'local_ip'

    if mode == 'hostname':
        host = (vals.get('notification_hostname') or '').strip()
        if not host:
            host = socket.gethostname()
        return f"http://{host}"

    if mode == 'tailscale':
        ip = _tailscale_ip()
        if ip:
            return f"http://{ip}"
        # Fall through to local_ip if Tailscale not reachable

    return f"http://{_local_ip()}"


def get_notification_base_url_fresh() -> str:
    """Open own DB connection — for use outside request context."""
    db = sqlite3.connect(cfg.db_path)
    db.row_factory = sqlite3.Row
    try:
        return get_notification_base_url(db)
    finally:
        db.close()
