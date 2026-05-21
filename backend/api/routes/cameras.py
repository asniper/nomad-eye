import asyncio
import glob
import cv2
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from api.routes.auth import require_auth
from camera.capture import CameraCapture
from camera.motion import MotionDetector

router = APIRouter()

_pipeline = None


def set_pipeline(pipeline):
    global _pipeline
    _pipeline = pipeline


def _probe_device(path: str) -> bool:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return False
    ret, _ = cap.read()
    cap.release()
    return ret


async def scan_and_refresh() -> list:
    """Probe /dev/video* for new cameras and add them to the pipeline."""
    if _pipeline is None:
        return []

    loop = asyncio.get_event_loop()
    existing_paths = {cam.device_path for cam in _pipeline._cameras}

    next_id = max((c.camera_id for c in _pipeline._cameras), default=-1) + 1
    new_captures = []

    for path in sorted(glob.glob("/dev/video*")):
        if path in existing_paths:
            continue
        ok = await loop.run_in_executor(None, _probe_device, path)
        if ok:
            dev_idx = int(path.replace("/dev/video", ""))
            cap = CameraCapture(camera_id=next_id, device_index=dev_idx)
            cap.start()
            new_captures.append(cap)
            next_id += 1

    _pipeline.refresh(new_captures)
    return _pipeline._cameras


@router.get("/")
def list_cameras(_=Depends(require_auth)):
    if _pipeline is None:
        return []
    with _pipeline._lock:
        return [{"id": cam.camera_id, "alive": cam.is_alive(), "device": cam.device_path}
                for cam in _pipeline._cameras]


@router.post("/refresh")
async def refresh_cameras(_=Depends(require_auth)):
    cams = await scan_and_refresh()
    return [{"id": cam.camera_id, "alive": cam.is_alive(), "device": cam.device_path}
            for cam in cams]


@router.post("/{camera_id}/overlay")
def toggle_overlay(camera_id: int, enabled: bool, _=Depends(require_auth)):
    if _pipeline:
        _pipeline.set_overlay(camera_id, enabled)
    return {"camera_id": camera_id, "overlay": enabled}


@router.websocket("/{camera_id}/stream")
async def stream(websocket: WebSocket, camera_id: int):
    await websocket.accept()
    if _pipeline is None:
        await websocket.close()
        return
    cam = next((c for c in _pipeline._cameras if c.camera_id == camera_id), None)
    if not cam:
        await websocket.close()
        return
    try:
        while True:
            frame_obj = cam.get_frame()
            if frame_obj is not None:
                frame = frame_obj.data.copy()
                if _pipeline._overlay_enabled.get(camera_id):
                    detections = _pipeline.get_latest(camera_id) or []
                    for d in detections:
                        x1, y1, x2, y2 = d.bbox
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                        cv2.putText(frame, f"{d.label} {d.confidence:.0%}", (x1, y1 - 8),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                await websocket.send_bytes(buf.tobytes())
            await asyncio.sleep(0.033)
    except WebSocketDisconnect:
        pass
