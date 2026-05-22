import cv2
import numpy as np
import sqlite3
import os
import time
import threading
from typing import List, Optional
from datetime import datetime, timezone
from config.settings import get_settings

try:
    import face_recognition as _fr
    _HAS_FR = True
except ImportError:
    _HAS_FR = False

_MATCH_THRESHOLD_FR   = 0.55   # L2 distance: lower = stricter (face_recognition lib)
_MATCH_THRESHOLD_HIST = 0.82   # cosine similarity: higher = stricter (OpenCV fallback)
_MIN_FACE_PX = 80              # ignore faces smaller than this in either dimension

cfg = get_settings()


class FaceRecognizer:
    def __init__(self):
        self._lock = threading.Lock()
        self._known: list = []  # [(face_id, name, encoding_ndarray, image_path)]
        self._min_confidence: float = 0.0
        if not _HAS_FR:
            cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
            self._cascade = cv2.CascadeClassifier(cascade_path)
        self._reload_from_db()

    # ------------------------------------------------------------------
    # Internal DB sync
    # ------------------------------------------------------------------
    def _reload_from_db(self):
        try:
            db = sqlite3.connect(cfg.db_path, timeout=10)
            db.row_factory = sqlite3.Row
            rows = db.execute(
                "SELECT id, name, encoding, image_path FROM known_faces"
            ).fetchall()
            known = []
            for r in rows:
                enc = np.frombuffer(bytes(r['encoding']), dtype=np.float64)
                known.append((r['id'], r['name'], enc, r['image_path']))
            db.close()
            with self._lock:
                self._known = known
        except Exception:
            pass

    def reload(self):
        self._reload_from_db()

    def set_min_confidence(self, value: float):
        self._min_confidence = max(0.0, min(1.0, value))

    # ------------------------------------------------------------------
    # Public: detect + recognize faces, returns Detection-compatible list
    # ------------------------------------------------------------------
    def detect_and_recognize(self, frame: np.ndarray) -> list:
        """Returns list of Detection(label, category='faces', confidence, bbox)."""
        results = self._detect_fr(frame) if _HAS_FR else self._detect_opencv(frame)
        if self._min_confidence > 0:
            results = [d for d in results if d.confidence >= self._min_confidence]
        return results

    # ------------------------------------------------------------------
    # face_recognition (dlib) path
    # ------------------------------------------------------------------
    def _detect_fr(self, frame: np.ndarray) -> list:
        from detection.detector import Detection
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        locations = _fr.face_locations(rgb, model='hog')
        if not locations:
            return []
        encodings = _fr.face_encodings(rgb, locations)
        results = []
        for (top, right, bottom, left), enc in zip(locations, encodings):
            w = right - left
            h = bottom - top
            if w < _MIN_FACE_PX or h < _MIN_FACE_PX:
                continue
            label, face_id, conf = self._match_fr(enc)
            if face_id is None:
                self._auto_save_async(frame, enc.astype(np.float64).tobytes(), (left, top, right, bottom))
            results.append(Detection(label=label, category='faces', confidence=conf,
                                     bbox=(left, top, right, bottom)))
        return results

    def _match_fr(self, encoding: np.ndarray):
        with self._lock:
            known = list(self._known)
        if not known:
            return 'Unknown', None, 0.0
        known_encs = [e for _, _, e, _ in known]
        distances = _fr.face_distance(known_encs, encoding)
        best = int(np.argmin(distances))
        d = float(distances[best])
        if d < _MATCH_THRESHOLD_FR:
            fid, name, _, _ = known[best]
            return name, fid, round(1.0 - d, 3)
        return 'Unknown', None, round(max(0.0, 1.0 - d), 3)

    # ------------------------------------------------------------------
    # OpenCV Haar cascade fallback
    # ------------------------------------------------------------------
    def _detect_opencv(self, frame: np.ndarray) -> list:
        from detection.detector import Detection
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self._cascade.detectMultiScale(
            gray, scaleFactor=1.2, minNeighbors=8,
            minSize=(_MIN_FACE_PX, _MIN_FACE_PX))
        if not isinstance(faces, np.ndarray) or len(faces) == 0:
            return []
        results = []
        for (x, y, w, h) in faces:
            crop = gray[y:y+h, x:x+w]
            enc = self._encode_opencv(crop)
            label, face_id, conf = self._match_opencv(enc)
            bbox = (x, y, x+w, y+h)
            if face_id is None:
                self._auto_save_async(frame, enc.tobytes(), bbox)
            results.append(Detection(label=label, category='faces', confidence=conf, bbox=bbox))
        return results

    @staticmethod
    def _encode_opencv(gray_face: np.ndarray) -> np.ndarray:
        resized = cv2.resize(gray_face, (64, 64)).astype(np.float64)
        norm = np.linalg.norm(resized)
        return resized.flatten() / (norm + 1e-8)

    def _match_opencv(self, encoding: np.ndarray):
        with self._lock:
            known = list(self._known)
        if not known:
            return 'Unknown', None, 0.0
        best_score, best_id, best_name = -1.0, None, 'Unknown'
        for fid, name, known_enc, _ in known:
            if known_enc.shape != encoding.shape:
                continue
            score = float(np.dot(encoding, known_enc))
            if score > best_score:
                best_score, best_id, best_name = score, fid, name
        if best_score >= _MATCH_THRESHOLD_HIST:
            return best_name, best_id, round(best_score, 3)
        return 'Unknown', None, round(max(0.0, best_score), 3)

    # ------------------------------------------------------------------
    # Auto-save unknown faces (deduped, non-blocking)
    # ------------------------------------------------------------------
    def _auto_save_async(self, frame: np.ndarray, enc_bytes: bytes, bbox):
        """Fire-and-forget: save new unknown face without blocking detection loop."""
        f = frame.copy()
        threading.Thread(target=self._auto_save, args=(f, enc_bytes, bbox), daemon=True).start()

    def _auto_save(self, frame: np.ndarray, enc_bytes: bytes, bbox):
        enc = np.frombuffer(enc_bytes, dtype=np.float64)
        # Skip if we already have a matching face
        with self._lock:
            known = list(self._known)
        for _, _, known_enc, _ in known:
            if _HAS_FR:
                if known_enc.shape == enc.shape:
                    d = float(np.linalg.norm(known_enc - enc))
                    if d < _MATCH_THRESHOLD_FR:
                        return
            else:
                if known_enc.shape == enc.shape:
                    if float(np.dot(enc, known_enc)) >= _MATCH_THRESHOLD_HIST:
                        return

        img_path = self._save_face_crop(frame, bbox)
        try:
            db = sqlite3.connect(cfg.db_path, timeout=10)
            db.execute(
                "INSERT INTO known_faces (name, encoding, image_path, created_at) VALUES (?,?,?,?)",
                ('Unknown', enc_bytes, img_path, datetime.now(timezone.utc).isoformat())
            )
            db.commit()
            db.close()
            self._reload_from_db()
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Shared image-save helper
    # ------------------------------------------------------------------
    def _save_face_crop(self, frame: np.ndarray, bbox) -> Optional[str]:
        try:
            from storage.manager import get_active_images_dir
            faces_dir = os.path.join(get_active_images_dir(), 'faces')
            os.makedirs(faces_dir, exist_ok=True)
            x1, y1, x2, y2 = bbox
            pad = 15
            hf, wf = frame.shape[:2]
            crop = frame[max(0, y1-pad):min(hf, y2+pad), max(0, x1-pad):min(wf, x2+pad)]
            img_path = os.path.join(faces_dir, f"face_{int(time.time()*1000)}.jpg")
            cv2.imwrite(img_path, crop)
            return img_path
        except Exception:
            return None

    # ------------------------------------------------------------------
    # API helpers
    # ------------------------------------------------------------------
    def list_faces(self) -> list:
        db = sqlite3.connect(cfg.db_path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            rows = db.execute(
                "SELECT id, name, image_path, created_at FROM known_faces ORDER BY name ASC, created_at DESC"
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            db.close()

    def rename_face(self, face_id: int, name: str) -> bool:
        db = sqlite3.connect(cfg.db_path, timeout=10)
        try:
            db.execute("UPDATE known_faces SET name=? WHERE id=?", (name.strip(), face_id))
            db.commit()
            self._reload_from_db()
            return True
        except Exception:
            return False
        finally:
            db.close()

    def delete_face(self, face_id: int) -> bool:
        db = sqlite3.connect(cfg.db_path, timeout=10)
        try:
            row = db.execute("SELECT image_path FROM known_faces WHERE id=?", (face_id,)).fetchone()
            if row and row[0]:
                try:
                    os.remove(row[0])
                except OSError:
                    pass
            db.execute("DELETE FROM known_faces WHERE id=?", (face_id,))
            db.commit()
            self._reload_from_db()
            return True
        except Exception:
            return False
        finally:
            db.close()

    def delete_unknown_faces(self) -> int:
        db = sqlite3.connect(cfg.db_path, timeout=10)
        try:
            rows = db.execute(
                "SELECT id, image_path FROM known_faces WHERE name='Unknown'"
            ).fetchall()
            for row in rows:
                if row[1]:
                    try:
                        os.remove(row[1])
                    except OSError:
                        pass
            count = len(rows)
            db.execute("DELETE FROM known_faces WHERE name='Unknown'")
            db.commit()
            self._reload_from_db()
            return count
        except Exception:
            return 0
        finally:
            db.close()

    def add_face_from_frame(self, frame: np.ndarray, name: str) -> Optional[int]:
        """Extract the largest detected face from a frame and save it with a name."""
        if _HAS_FR:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            locations = _fr.face_locations(rgb, model='hog')
            encodings = _fr.face_encodings(rgb, locations)
            if not encodings:
                return None
            best = max(range(len(locations)),
                       key=lambda i: (locations[i][2] - locations[i][0]) * (locations[i][1] - locations[i][3]))
            top, right, bottom, left = locations[best]
            enc_bytes = encodings[best].astype(np.float64).tobytes()
            bbox = (left, top, right, bottom)
        else:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = self._cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5,
                minSize=(_MIN_FACE_PX, _MIN_FACE_PX))
            if not isinstance(faces, np.ndarray) or len(faces) == 0:
                return None
            areas = [w * h for (_, _, w, h) in faces]
            x, y, w, h = faces[int(np.argmax(areas))]
            enc_bytes = self._encode_opencv(gray[y:y+h, x:x+w]).tobytes()
            bbox = (x, y, x+w, y+h)

        img_path = self._save_face_crop(frame, bbox)
        db = sqlite3.connect(cfg.db_path, timeout=10)
        try:
            cursor = db.execute(
                "INSERT INTO known_faces (name, encoding, image_path, created_at) VALUES (?,?,?,?)",
                (name.strip() or 'Unknown', enc_bytes, img_path,
                 datetime.now(timezone.utc).isoformat())
            )
            face_id = cursor.lastrowid
            db.commit()
            self._reload_from_db()
            return face_id
        except Exception:
            return None
        finally:
            db.close()

    @property
    def backend(self) -> str:
        return 'face_recognition' if _HAS_FR else 'opencv_haar'
