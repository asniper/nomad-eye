import json
import subprocess
import sqlite3
from pathlib import Path
from config.settings import get_settings

cfg = get_settings()

INTERNAL_IMAGES_DIR = "/home/arduino/nomadeye-data/images"
STORAGE_HELPER = "/opt/nomad-eye/storage-helper.sh"


def get_active_images_dir() -> str:
    try:
        db = sqlite3.connect(cfg.db_path)
        row = db.execute("SELECT value FROM app_config WHERE key='storage_primary_device'").fetchone()
        db.close()
    except Exception:
        row = None

    if row and row[0]:
        mp = _get_mount_point(row[0])
        if mp:
            try:
                images_path = Path(mp) / "nomadeye" / "images"
                images_path.mkdir(parents=True, exist_ok=True)
                return str(images_path)
            except Exception:
                pass  # fall through to internal storage

    internal = Path(INTERNAL_IMAGES_DIR)
    internal.mkdir(parents=True, exist_ok=True)
    return str(internal)


def _run_lsblk(device: str = None) -> dict:
    cmd = ["/usr/bin/lsblk", "--json", "-o", "NAME,SIZE,TYPE,MOUNTPOINT,LABEL,FSTYPE,RM,MODEL"]
    if device:
        cmd.append(f"/dev/{device}")
    try:
        out = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
        return json.loads(out)
    except Exception:
        return {"blockdevices": []}


def _is_external(name: str) -> bool:
    if name.startswith("sd"):
        return True
    if name.startswith("mmcblk") and not name.startswith("mmcblk0"):
        return True
    return False


def _parse_rm(val) -> bool:
    return val in ("1", True, 1)


def _device_entry(dev: dict, parent: str = None, parent_model: str = None) -> dict:
    return {
        "name": dev.get("name", ""),
        "size": dev.get("size", ""),
        "type": dev.get("type", ""),
        "mountpoint": dev.get("mountpoint") or None,
        "label": dev.get("label") or None,
        "fstype": dev.get("fstype") or None,
        "removable": _parse_rm(dev.get("rm")),
        "model": dev.get("model") or parent_model or None,
        "parent": parent,
    }


def list_external_devices() -> list:
    data = _run_lsblk()
    result = []
    for dev in data.get("blockdevices", []):
        name = dev.get("name", "")
        if not _is_external(name):
            continue
        model = dev.get("model") or None
        children = dev.get("children") or []
        if children:
            for child in children:
                result.append(_device_entry(child, parent=name, parent_model=model))
        else:
            result.append(_device_entry(dev, parent=None))
    return result


def _find_mountpoint(devs: list, target: str) -> str | None:
    for dev in devs:
        if dev.get("name") == target:
            return dev.get("mountpoint") or None
        found = _find_mountpoint(dev.get("children") or [], target)
        if found is not None:
            return found
    return None


def _get_mount_point(device_name: str) -> str | None:
    data = _run_lsblk()
    return _find_mountpoint(data.get("blockdevices", []), device_name)


def mount_device(device_name: str) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            ["/usr/bin/sudo", STORAGE_HELPER, "mount", device_name],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            return True, result.stdout.strip()
        return False, result.stderr.strip() or "Mount failed"
    except Exception as e:
        return False, str(e)


def unmount_device(device_name: str) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            ["/usr/bin/sudo", STORAGE_HELPER, "unmount", device_name],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            return True, "Unmounted"
        return False, result.stderr.strip() or "Unmount failed"
    except Exception as e:
        return False, str(e)


def auto_mount_primary() -> None:
    try:
        db = sqlite3.connect(cfg.db_path)
        row = db.execute("SELECT value FROM app_config WHERE key='storage_primary_device'").fetchone()
        db.close()
    except Exception:
        return
    if not row or not row[0]:
        return
    device = row[0]
    if _get_mount_point(device):
        return  # already mounted
    mount_device(device)


def format_device(device_name: str) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            ["/usr/bin/sudo", STORAGE_HELPER, "format_ext4", device_name],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            return True, "Formatted successfully"
        return False, result.stderr.strip() or "Format failed"
    except Exception as e:
        return False, str(e)
