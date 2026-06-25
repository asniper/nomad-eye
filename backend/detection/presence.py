import concurrent.futures
import os
import re
import socket
import sqlite3
import subprocess
import threading
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from config.settings import get_settings

cfg = get_settings()

_STORAGE_HELPER = str(Path(__file__).parent.parent.parent / 'storage-helper.sh')

# Matches: "192.168.0.1\taa:bb:cc:dd:ee:ff\tVendor Name"
_ARP_RE = re.compile(r'^(\d{1,3}(?:\.\d{1,3}){3})\s+([\da-fA-F]{2}(?::[\da-fA-F]{2}){5})\s*(.*)')


def _resolve_hostname(ip):
    try:
        name = socket.gethostbyaddr(ip)[0]
        return name if name and name != ip else None
    except Exception:
        return None


def _enrich_hostnames(devices):
    """Parallel reverse DNS lookups, best-effort within 4 seconds."""
    if not devices:
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(devices), 30)) as ex:
        futures = {ex.submit(_resolve_hostname, d['ip']): i for i, d in enumerate(devices)}
        done, _ = concurrent.futures.wait(futures, timeout=4)
        for f in done:
            idx = futures[f]
            try:
                h = f.result()
                if h:
                    devices[idx]['hostname'] = h
            except Exception:
                pass


def run_arp_scan():
    """Run arp-scan via storage-helper. Returns list of {ip, mac, vendor, hostname?} or None on error."""
    try:
        result = subprocess.run(
            ['sudo', _STORAGE_HELPER, 'arp-scan'],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return None
        devices = []
        for line in result.stdout.splitlines():
            m = _ARP_RE.match(line.strip())
            if m:
                devices.append({
                    'ip': m.group(1),
                    'mac': m.group(2).lower(),
                    'vendor': m.group(3).strip(),
                })
        _enrich_hostnames(devices)
        return devices
    except Exception:
        return None


def _read_config(db):
    rows = db.execute(
        "SELECT key, value FROM app_config WHERE key IN "
        "('presence_enabled','presence_timeout','presence_home_status','presence_away_status')"
    ).fetchall()
    vals = {r[0]: r[1] for r in rows}
    return {
        'enabled': vals.get('presence_enabled', '0') == '1',
        'timeout_min': int(vals.get('presence_timeout', '5')),
        'home_status': vals.get('presence_home_status', 'home'),
        'away_status': vals.get('presence_away_status', 'away'),
    }


class PresenceScanner:
    def __init__(self):
        self._running = False
        self._thread = None
        self._lock = threading.Lock()
        self._last_scan_time = None
        self._last_scan_devices = []

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    def scan_now(self):
        """Immediate scan for API use. Returns list or None on error."""
        devices = run_arp_scan()
        if devices is not None:
            with self._lock:
                self._last_scan_time = datetime.now(timezone.utc).isoformat()
                self._last_scan_devices = devices
        return devices

    def last_info(self):
        with self._lock:
            return {
                'last_scan': self._last_scan_time,
                'devices': list(self._last_scan_devices),
            }

    def _run(self):
        while self._running:
            try:
                db = sqlite3.connect(cfg.db_path)
                db.row_factory = sqlite3.Row
                config = _read_config(db)
                db.close()
                if config['enabled']:
                    self._scan_once(config)
            except Exception:
                pass
            time.sleep(30)

    def _scan_once(self, config):
        devices = run_arp_scan()
        if devices is None:
            return
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        with self._lock:
            self._last_scan_time = now_iso
            self._last_scan_devices = devices

        scan_macs = {d['mac'] for d in devices}

        db = sqlite3.connect(cfg.db_path)
        db.row_factory = sqlite3.Row

        watched = db.execute(
            "SELECT id, mac_address, last_seen FROM presence_devices WHERE active = 1"
        ).fetchall()

        for dev in watched:
            if dev['mac_address'].lower() in scan_macs:
                db.execute(
                    "UPDATE presence_devices SET last_seen = ? WHERE id = ?",
                    (now_iso, dev['id'])
                )
        db.commit()

        # Reload with fresh timestamps
        watched = db.execute(
            "SELECT id, mac_address, last_seen FROM presence_devices WHERE active = 1"
        ).fetchall()

        timeout_dt = now - timedelta(minutes=config['timeout_min'])
        any_present = False
        for dev in watched:
            if dev['last_seen']:
                try:
                    dt = datetime.fromisoformat(dev['last_seen'])
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    if dt >= timeout_dt:
                        any_present = True
                        break
                except ValueError:
                    pass

        status_row = db.execute("SELECT status FROM device_status WHERE id = 1").fetchone()
        current = status_row['status'] if status_row else 'home'
        target = config['home_status'] if any_present else config['away_status']
        if current != target:
            db.execute("UPDATE device_status SET status = ? WHERE id = 1", (target,))
            db.commit()

        db.close()
