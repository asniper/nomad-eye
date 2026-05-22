import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from models.database import get_db
from api.routes.auth import require_auth
import sqlite3

router = APIRouter()

class ContactCreate(BaseModel):
    name: str
    type: str
    value: str
    carrier: Optional[str] = None

class RuleCreate(BaseModel):
    contact_id: int
    categories: Optional[List[str]] = None
    labels: Optional[List[str]] = None
    device_statuses: Optional[List[str]] = None
    time_start: Optional[str] = None
    time_end: Optional[str] = None
    frequency: Optional[str] = 'instant'

def _row_to_contact(r):
    d = dict(r)
    d['value'] = d.pop('address', d.get('value', ''))
    d.setdefault('carrier', None)
    return d

def _row_to_rule(r):
    d = dict(r)
    for field in ('categories', 'labels', 'device_statuses'):
        raw = d.get(field)
        if raw:
            try:
                d[field] = json.loads(raw)
            except Exception:
                d[field] = [raw]
        else:
            d[field] = None
    d.setdefault('frequency', 'instant')
    d.setdefault('last_notified_at', None)
    return d

@router.get("/contacts")
def list_contacts(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    return [_row_to_contact(r) for r in db.execute("SELECT * FROM contacts").fetchall()]

@router.post("/contacts")
def create_contact(body: ContactCreate, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    cursor = db.execute(
        "INSERT INTO contacts (name, type, address, carrier) VALUES (?,?,?,?)",
        (body.name, body.type, body.value, body.carrier)
    )
    db.commit()
    row = db.execute("SELECT * FROM contacts WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_contact(row)

@router.patch("/contacts/{contact_id}")
def patch_contact(contact_id: int, body: dict, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    if 'active' in body:
        db.execute("UPDATE contacts SET active = ? WHERE id = ?", (1 if body['active'] else 0, contact_id))
        db.commit()
    row = db.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return _row_to_contact(row)

@router.delete("/contacts/{contact_id}")
def delete_contact(contact_id: int, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    db.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))
    db.execute("DELETE FROM notification_rules WHERE contact_id = ?", (contact_id,))
    db.commit()
    return {"deleted": contact_id}

@router.post("/contacts/{contact_id}/test")
async def test_contact(contact_id: int, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    contact = db.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,)).fetchone()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    from notifications.sms import send_sms
    from notifications.email import send_email
    from datetime import datetime, timezone
    message = f"Nomad Eye test notification\nSent: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"
    try:
        if contact["type"] == "sms":
            await send_sms(contact["address"], contact["carrier"] or "", message, None)
        else:
            await send_email(contact["address"], "Nomad Eye: Test", message, None)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@router.get("/rules")
def list_rules(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    rows = db.execute("SELECT * FROM notification_rules").fetchall()
    return [_row_to_rule(r) for r in rows]

@router.post("/rules")
def create_rule(body: RuleCreate, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    cursor = db.execute(
        "INSERT INTO notification_rules (contact_id, categories, labels, device_statuses, time_start, time_end, frequency) VALUES (?,?,?,?,?,?,?)",
        (
            body.contact_id,
            json.dumps(body.categories) if body.categories else None,
            json.dumps(body.labels) if body.labels else None,
            json.dumps(body.device_statuses) if body.device_statuses else None,
            body.time_start,
            body.time_end,
            body.frequency or 'instant',
        )
    )
    db.commit()
    row = db.execute("SELECT * FROM notification_rules WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_rule(row)

@router.patch("/rules/{rule_id}")
def patch_rule(rule_id: int, body: dict, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    fields, values = [], []
    if 'active' in body:
        fields.append('active = ?'); values.append(1 if body['active'] else 0)
    if 'contact_id' in body:
        fields.append('contact_id = ?'); values.append(body['contact_id'])
    if 'categories' in body:
        fields.append('categories = ?'); values.append(json.dumps(body['categories']) if body['categories'] else None)
    if 'device_statuses' in body:
        fields.append('device_statuses = ?'); values.append(json.dumps(body['device_statuses']) if body['device_statuses'] else None)
    if 'time_start' in body:
        fields.append('time_start = ?'); values.append(body['time_start'])
    if 'time_end' in body:
        fields.append('time_end = ?'); values.append(body['time_end'])
    if 'frequency' in body:
        fields.append('frequency = ?'); values.append(body['frequency'] or 'instant')
    if fields:
        values.append(rule_id)
        db.execute(f"UPDATE notification_rules SET {', '.join(fields)} WHERE id = ?", values)
        db.commit()
    row = db.execute("SELECT * FROM notification_rules WHERE id = ?", (rule_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return _row_to_rule(row)

@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    db.execute("DELETE FROM notification_rules WHERE id = ?", (rule_id,))
    db.commit()
    return {"deleted": rule_id}

@router.get("/log")
def get_log(limit: int = 50, offset: int = 0, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    rows = db.execute(
        "SELECT * FROM notification_log ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        (limit, offset)
    ).fetchall()
    return [dict(r) for r in rows]

@router.delete("/log")
def clear_log(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    db.execute("DELETE FROM notification_log")
    db.commit()
    return {"cleared": True}
