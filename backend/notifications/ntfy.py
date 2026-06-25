import os
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


def _header_val(s: str) -> str:
    """Sanitize string for use as an HTTP header value (ASCII, no control chars)."""
    _SUBS = {'·': '-', '’': "'", '‘': "'",
             '“': '"', '”': '"', '—': '--', '–': '-'}
    for ch, rep in _SUBS.items():
        s = s.replace(ch, rep)
    s = s.replace('\n', ' | ').replace('\r', '')
    return s.encode('ascii', errors='replace').decode('ascii')


async def send_ntfy(topic: str, message: str, title: str = 'Nomad Eye Alert',
                    click_url: str = None, category: str = None, image_path: str = None):
    """POST or PUT a notification to an ntfy topic.

    If image_path is provided and ntfy_send_images is enabled, attaches the image
    via PUT (binary body, message in header). Otherwise POSTs plain text.
    """
    db = sqlite3.connect(cfg.db_path)
    db.row_factory = sqlite3.Row
    rows = db.execute(
        "SELECT key, value FROM app_config WHERE key IN "
        "('ntfy_server', 'ntfy_token', 'ntfy_send_images')"
    ).fetchall()
    db.close()
    vals = {r['key']: r['value'] for r in rows}

    server = (vals.get('ntfy_server') or 'https://ntfy.sh').rstrip('/')
    token = vals.get('ntfy_token') or None
    send_images = vals.get('ntfy_send_images', '1') != '0'

    priority = _CATEGORY_PRIORITY.get(category or '', 3)
    url = f'{server}/{topic}'

    headers = {
        'Title': _header_val(title),
        'Priority': str(priority),
    }
    if click_url:
        headers['Click'] = click_url
    if token:
        headers['Authorization'] = f'Bearer {token}'

    # Attach image via PUT if available and enabled
    img_data = None
    if send_images and image_path:
        try:
            with open(image_path, 'rb') as f:
                img_data = f.read()
        except (IOError, OSError):
            img_data = None

    if img_data:
        ext = os.path.splitext(image_path)[1].lower()
        content_type = 'image/png' if ext == '.png' else 'image/jpeg'
        headers['Content-Type'] = content_type
        headers['Filename'] = 'detection' + ext
        headers['Message'] = _header_val(message)
        data = img_data
        method = 'PUT'
    else:
        headers['Content-Type'] = 'text/plain; charset=utf-8'
        data = message.encode('utf-8')
        method = 'POST'

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status >= 400:
                raise ValueError(f'ntfy returned HTTP {resp.status}')
    except urllib.error.HTTPError as exc:
        raise ValueError(f'ntfy error {exc.code}: {exc.reason}') from exc
    except urllib.error.URLError as exc:
        raise ValueError(f'ntfy connection failed: {exc.reason}') from exc
