import asyncio
import json
import re
import subprocess
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from pydantic import BaseModel
from networking.manager import (
    get_known_networks, connect_to_network, connect_saved_network, save_network,
    start_access_point, stop_access_point, get_current_ip, is_connected, nmcli,
    _terse_split, get_network_status
)
from api.routes.auth import require_admin
from storage.manager import STORAGE_HELPER


def _set_tailscale_operator():
    try:
        subprocess.run(
            ['/usr/bin/sudo', STORAGE_HELPER, 'tailscale-set-operator'],
            capture_output=True, timeout=10
        )
    except Exception:
        pass


_NGINX_CERT = '/etc/nginx/ssl/nomadeye.crt'


def _https_cert_info():
    """Inspect the deployed nginx cert to see if it's the Tailscale/Let's Encrypt
    cert (vs the self-signed LAN default). Reads the actual file on disk rather
    than trusting any in-memory state, so this survives page reloads and restarts."""
    try:
        r = subprocess.run(
            ['openssl', 'x509', '-in', _NGINX_CERT, '-noout', '-issuer', '-subject', '-enddate'],
            capture_output=True, text=True, timeout=5
        )
        if r.returncode != 0:
            return {"tailscale_https": False, "https_hostname": None, "https_expires": None}
        out = r.stdout
        is_le = 'Let\'s Encrypt' in out
        hostname_match = re.search(r'CN\s*=\s*([^\n,]+)', out)
        hostname = hostname_match.group(1).strip() if hostname_match else None
        end_match = re.search(r'notAfter=(.+)', out)
        expires = end_match.group(1).strip() if end_match else None
        return {
            "tailscale_https": is_le and bool(hostname) and hostname.endswith('.ts.net'),
            "https_hostname": hostname if is_le else None,
            "https_expires": expires if is_le else None,
        }
    except Exception:
        return {"tailscale_https": False, "https_hostname": None, "https_expires": None}

router = APIRouter()


class ConnectRequest(BaseModel):
    ssid: str
    password: str


class SavedConnectRequest(BaseModel):
    ssid: str


class AddNetworkRequest(BaseModel):
    ssid: str
    password: str


def _get_current_ssid() -> str:
    raw = nmcli("-t", "-f", "ACTIVE,SSID", "dev", "wifi")
    for line in raw.splitlines():
        parts = _terse_split(line, maxsplit=1)
        if len(parts) == 2 and parts[0].lower() == "yes":
            return parts[1]
    return ""


def _is_ap_active() -> bool:
    raw = nmcli("-t", "-f", "NAME,STATE", "con", "show", "--active")
    return any("NomadEye-AP" in line for line in raw.splitlines())


def _get_hostname() -> str:
    import socket
    return socket.gethostname()


@router.get("/")
def network_status(_=Depends(require_admin)):
    status = get_network_status()
    status["hostname"] = _get_hostname()
    return status


@router.get("/known")
def known_networks(_=Depends(require_admin)):
    return get_known_networks()


@router.delete("/known/{ssid}")
def delete_network(ssid: str, _=Depends(require_admin)):
    import subprocess
    result = subprocess.run(
        ["/usr/bin/nmcli", "con", "delete", ssid],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=result.stderr.strip() or "Failed to delete network")
    return {"deleted": ssid}


@router.post("/connect")
async def connect(body: ConnectRequest, background_tasks: BackgroundTasks, _=Depends(require_admin)):
    """Kick off a WiFi connection attempt and return immediately.
    The client should poll GET /api/network/ to detect when it connects."""
    background_tasks.add_task(connect_to_network, body.ssid, body.password)
    return {"status": "connecting", "ssid": body.ssid}


@router.post("/connect-saved")
async def connect_saved(body: SavedConnectRequest, background_tasks: BackgroundTasks, _=Depends(require_admin)):
    """Re-activate a saved NetworkManager profile (no password needed)."""
    background_tasks.add_task(connect_saved_network, body.ssid)
    return {"status": "connecting", "ssid": body.ssid}


@router.post("/add")
def add_network(body: AddNetworkRequest, _=Depends(require_admin)):
    save_network(body.ssid, body.password)
    return {"saved": True}


@router.get("/scan")
def scan(_=Depends(require_admin)):
    # Trigger a fresh scan; ignore errors (e.g. already scanning, rate-limited)
    try:
        nmcli("dev", "wifi", "rescan")
        import time; time.sleep(3)
    except Exception:
        pass
    raw = nmcli("--terse", "--fields", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list")
    known_ssids = {n["ssid"] for n in get_known_networks()}
    seen = set()
    results = []
    for line in raw.splitlines():
        parts = _terse_split(line, maxsplit=2)
        ssid = parts[0] if parts else ""
        if not ssid or ssid in seen:
            continue
        seen.add(ssid)
        try:
            signal = int(parts[1]) if len(parts) > 1 and parts[1].strip().isdigit() else None
        except ValueError:
            signal = None
        results.append({
            "ssid": ssid,
            "signal": signal,
            "security": parts[2].strip() if len(parts) > 2 else "",
            "saved": ssid in known_ssids,
        })
    return sorted(results, key=lambda x: x["signal"] or 0, reverse=True)


@router.post("/ap/start")
def ap_start(_=Depends(require_admin)):
    try:
        start_access_point()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ap": "started", "active": _is_ap_active()}


@router.post("/ap/stop")
def ap_stop(_=Depends(require_admin)):
    stop_access_point()
    return {"ap": "stopped", "active": _is_ap_active()}


@router.post("/tailscale/auth-url")
def tailscale_auth_url(_=Depends(require_admin)):
    import re
    try:
        result = subprocess.run(
            ['tailscale', 'up'],
            capture_output=True, text=True, timeout=8,
        )
        combined = result.stdout + result.stderr
    except subprocess.TimeoutExpired as e:
        s = e.stdout or ''
        err = e.stderr or ''
        if isinstance(s, bytes): s = s.decode('utf-8', errors='replace')
        if isinstance(err, bytes): err = err.decode('utf-8', errors='replace')
        combined = s + err
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail='Tailscale is not installed')

    match = re.search(r'https://login\.tailscale\.com/a/\w+', combined)
    if match:
        _set_tailscale_operator()
        return {"auth_url": match.group(0), "already_connected": False}

    try:
        r2 = subprocess.run(['tailscale', 'status', '--json'], capture_output=True, text=True, timeout=5)
        data = json.loads(r2.stdout)
        if data.get('BackendState') == 'Running':
            _set_tailscale_operator()
            return {"auth_url": None, "already_connected": True}
    except Exception:
        pass

    raise HTTPException(status_code=500, detail='Could not get auth URL. Tailscale may not be running.')


class TailscaleUpRequest(BaseModel):
    auth_key: str = ""


@router.post("/tailscale/up")
def tailscale_up(body: TailscaleUpRequest, _=Depends(require_admin)):
    cmd = ['tailscale', 'up', '--accept-routes']
    if body.auth_key.strip():
        cmd.append(f'--authkey={body.auth_key.strip()}')
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if result.returncode != 0:
            err = (result.stderr or result.stdout or '').strip()
            if 'already' not in err.lower():
                raise HTTPException(status_code=500, detail=err or 'Failed to connect')
        _set_tailscale_operator()
        return {"status": "up"}
    except subprocess.TimeoutExpired:
        _set_tailscale_operator()
        return {"status": "pending"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail='Tailscale is not installed')


@router.post("/tailscale/down")
def tailscale_down(_=Depends(require_admin)):
    try:
        result = subprocess.run(['tailscale', 'down'], capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=result.stderr.strip() or 'Failed to disconnect')
        return {"status": "down"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail='Tailscale is not installed')


@router.post("/tailscale/logout")
def tailscale_logout(_=Depends(require_admin)):
    try:
        result = subprocess.run(['tailscale', 'logout'], capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=result.stderr.strip() or 'Failed to logout')
        return {"status": "logged_out"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail='Tailscale is not installed')


@router.get("/tailscale")
def tailscale_status(_=Depends(require_admin)):
    cert = _https_cert_info()
    try:
        r = subprocess.run(['tailscale', 'status', '--json'],
                           capture_output=True, text=True, timeout=5)
    except FileNotFoundError:
        return {"installed": False, "connected": False, "ip": None, "hostname": None, "dns_name": None, **cert}
    except Exception:
        return {"installed": True, "connected": False, "ip": None, "hostname": None, "dns_name": None, **cert}
    if r.returncode != 0:
        return {"installed": True, "connected": False, "ip": None, "hostname": None, "dns_name": None, **cert}
    try:
        data = json.loads(r.stdout)
        self_node = data.get('Self', {})
        ips = self_node.get('TailscaleIPs', [])
        ipv4 = next((ip for ip in ips if ':' not in ip), None)
        dns_name = self_node.get('DNSName', '').rstrip('.')
        return {
            "installed": True,
            "connected": data.get('BackendState') == 'Running',
            "ip": ipv4,
            "hostname": self_node.get('HostName', ''),
            "dns_name": dns_name,
            **cert,
        }
    except Exception:
        return {"installed": True, "connected": False, "ip": None, "hostname": None, "dns_name": None, **cert}


@router.post("/tailscale/enable-https")
def tailscale_enable_https(_=Depends(require_admin)):
    """Issue a real Let's Encrypt-backed cert for this device's *.ts.net hostname via
    `tailscale cert`, and point nginx's HTTPS listener at it — replacing the self-signed
    LAN cert. Requires Tailscale to be connected and HTTPS Certificates enabled on the
    tailnet (a checkbox in the Tailscale admin console, off by default on some plans)."""
    try:
        result = subprocess.run(
            ['/usr/bin/sudo', STORAGE_HELPER, 'tls-enable-tailscale'],
            capture_output=True, text=True, timeout=30
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail='Timed out waiting for tailscale cert')
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr.strip() or 'Failed to issue certificate')
    return {"success": True, "hostname": result.stdout.strip()}
