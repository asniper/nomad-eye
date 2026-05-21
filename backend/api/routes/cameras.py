from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
import cv2
import asyncio
from api.routes.auth import require_auth
from fastapi import Depends

router = APIRouter()

_pipeline = None

def set_pipeline(pipeline):
    global _pipeline
    _pipeline = pipeline

@router.get("/")
def list_cameras(_=Depends(require_auth)):
    return [{"id": cam.camera_id, "alive": cam.is_alive()} for cam in _pipeline._cameras]

@router.post("/{camera_id}/overlay")
def toggle_overlay(camera_id: int, enabled: bool, _=Depends(require_auth)):
    _pipeline.set_overlay(camera_id, enabled)
    return {"camera_id": camera_id, "overlay": enabled}

@router.websocket("/{camera_id}/stream")
async def stream(websocket: WebSocket, camera_id: int):
    await websocket.accept()
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
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        pass
