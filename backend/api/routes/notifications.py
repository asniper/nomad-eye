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

class RuleCreate(BaseModel):
    contact_id: int
    categories: Optional[List[str]] = None
    labels: Optional[List[str]] = None
    device_statuses: Optional[List[str]] = None
    time_start: Optional[str] = None
    time_end: Optional[str] = None

def _row_to_contact(r):
    d = dict(r)
    d['value'] = d.pop('address', d.get('value', ''))
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
    return d

@router.get("/contacts")
def list_contacts(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    return [_row_to_contact(r) for r in db.execute("SELECT * FROM contacts").fetchall()]

@router.post("/contacts")
def create_contact(body: ContactCreate, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    cursor = db.execute(
        "INSERT INTO contacts (name, type, address) VALUES (?,?,?)",
        (body.name, body.type, body.value)
    )
    db.commit()
    return {"id": cursor.lastrowid}

@router.delete("/contacts/{contact_id}")
def delete_contact(contact_id: int, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    db.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))
    db.execute("DELETE FROM notification_rules WHERE contact_id = ?", (contact_id,))
    db.commit()
    return {"deleted": contact_id}

@router.get("/rules")
def list_rules(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    rows = db.execute("SELECT * FROM notification_rules").fetchall()
    return [_row_to_rule(r) for r in rows]

@router.post("/rules")
def create_rule(body: RuleCreate, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    cursor = db.execute(
        "INSERT INTO notification_rules (contact_id, categories, labels, device_statuses, time_start, time_end) VALUES (?,?,?,?,?,?)",
        (
            body.contact_id,
            json.dumps(body.categories) if body.categories else None,
            json.dumps(body.labels) if body.labels else None,
            json.dumps(body.device_statuses) if body.device_statuses else None,
            body.time_start,
            body.time_end,
        )
    )
    db.commit()
    return {"id": cursor.lastrowid}

@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    db.execute("DELETE FROM notification_rules WHERE id = ?", (rule_id,))
    db.commit()
    return {"deleted": rule_id}
