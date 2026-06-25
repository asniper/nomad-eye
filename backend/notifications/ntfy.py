import sqlite3
import urllib.request
import urllib.error
from config.settings import get_settings

cfg = get_settings()

# ntfy priority levels: 1=min 2=low 3=default 4=high 5=max
_CATEGORY_PRIORITY = {
    'people':   4,
    'faces':    4,
    'vehicles': 3,
    'animals':  3,
    'other':    3,
}


async def send_ntfy(topic: str, message: str, title: str = 'Nomad Eye Alert',
                    click_url: str = None, category: str = None):
    """POST a notification to an ntfy topic.

    Reads ntfy_server and ntfy_token from app_config.
    ntfy_server defaults to https://ntfy.sh.
    ntfy_token is an optional Bearer token for private topics or self-hosted servers.
    """
    db = sqlite3.connect(cfg.db_path)
    db.row_factory = sqlite3.Row
    rows = db.execute(
        "SELECT key, value FROM app_config WHERE key IN ('ntfy_server', 'ntfy_token')"
    ).fetchall()
    db.close()
    vals = {r['key']: r['value'] for r in rows}

    server = (vals.get('ntfy_server') or 'https://ntfy.sh').rstrip('/')
    token = vals.get('ntfy_token') or None

    priority = _CATEGORY_PRIORITY.get(category or '', 3)
    url = f'{server}/{topic}'

    headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Title': title,
        'Priority': str(priority),
    }
    if click_url:
        headers['Click'] = click_url
    if token:
        headers['Authorization'] = f'Bearer {token}'

    data = message.encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status >= 400:
                raise ValueError(f'ntfy returned HTTP {resp.status}')
    except urllib.error.HTTPError as exc:
        raise ValueError(f'ntfy error {exc.code}: {exc.reason}') from exc
    except urllib.error.URLError as exc:
        raise ValueError(f'ntfy connection failed: {exc.reason}') from exc
