import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from api.routes.auth import require_auth

router = APIRouter()

_pipeline = None


def set_pipeline(pipeline):
    global _pipeline
    _pipeline = pipeline


class RenameBody(BaseModel):
    name: str


@router.get("/")
def list_faces(_=Depends(require_auth)):
    if _pipeline is None:
        return []
    return _pipeline._face_recognizer.list_faces()


@router.get("/{face_id}/image")
def get_face_image(face_id: int, _=Depends(require_auth)):
    if _pipeline is None:
        raise HTTPException(404)
    faces = _pipeline._face_recognizer.list_faces()
    face = next((f for f in faces if f['id'] == face_id), None)
    if not face or not face.get('image_path'):
        raise HTTPException(404)
    path = face['image_path']
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path, media_type='image/jpeg')


@router.patch("/{face_id}")
def rename_face(face_id: int, body: RenameBody, _=Depends(require_auth)):
    if _pipeline is None:
        raise HTTPException(503)
    ok = _pipeline._face_recognizer.rename_face(face_id, body.name)
    if not ok:
        raise HTTPException(404)
    return {"id": face_id, "name": body.name.strip()}


@router.delete("/unknown")
def delete_unknown_faces(_=Depends(require_auth)):
    if _pipeline is None:
        return {"deleted": 0}
    count = _pipeline._face_recognizer.delete_unknown_faces()
    return {"deleted": count}


@router.delete("/{face_id}")
def delete_face(face_id: int, _=Depends(require_auth)):
    if _pipeline is None:
        raise HTTPException(503)
    ok = _pipeline._face_recognizer.delete_face(face_id)
    if not ok:
        raise HTTPException(404)
    return {"ok": True}


@router.post("/capture")
def capture_face_from_camera(camera_id: int, name: str = "Unknown", _=Depends(require_auth)):
    """Grab the latest frame from a camera and add any detected face to known faces."""
    if _pipeline is None:
        raise HTTPException(503, "Pipeline not running")
    cam = next((c for c in _pipeline._cameras if c.camera_id == camera_id), None)
    if cam is None or not cam.is_alive():
        raise HTTPException(404, "Camera not found or offline")
    frame_obj = cam.get_frame()
    if frame_obj is None:
        raise HTTPException(503, "No frame available")
    face_id = _pipeline._face_recognizer.add_face_from_frame(frame_obj.data.copy(), name)
    if face_id is None:
        raise HTTPException(422, "No face detected in frame")
    return {"id": face_id, "name": name}


@router.post("/{face_id}/disassociate")
def disassociate_face(face_id: int, _=Depends(require_auth)):
    if _pipeline is None:
        raise HTTPException(503)
    ok = _pipeline._face_recognizer.rename_face(face_id, 'Unknown')
    if not ok:
        raise HTTPException(404)
    return {"id": face_id, "name": "Unknown"}


@router.post("/{face_id}/merge-into/{target_id}")
def merge_face_into(face_id: int, target_id: int, _=Depends(require_auth)):
    if _pipeline is None:
        raise HTTPException(503)
    faces = _pipeline._face_recognizer.list_faces()
    target = next((f for f in faces if f['id'] == target_id), None)
    if not target:
        raise HTTPException(404, "Target face not found")
    ok = _pipeline._face_recognizer.rename_face(face_id, target['name'])
    if not ok:
        raise HTTPException(404, "Source face not found")
    return {"id": face_id, "name": target['name']}


@router.get("/backend")
def get_backend(_=Depends(require_auth)):
    if _pipeline is None:
        return {"backend": "unavailable"}
    return {"backend": _pipeline._face_recognizer.backend}
