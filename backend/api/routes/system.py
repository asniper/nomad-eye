import os
import subprocess
import threading
import time
import psutil
from fastapi import APIRouter, Depends
from api.routes.auth import require_auth

router = APIRouter()


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
