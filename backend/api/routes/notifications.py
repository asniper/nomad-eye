from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from models.database import get_db
from api.routes.auth import require_auth
import sqlite3

router = APIRouter()

class ContactCreate(BaseModel):
    name: str
    type: str
    address: str

class RuleCreate(BaseModel):
    contact_id: int
    category: Optional[str] = None
    label: Optional[str] = None
    status_filter: Optional[str] = None
    time_start: Optional[str] = None
    time_end: Optional[str] = None

@router.get("/contacts")
def list_contacts(db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    return [dict(r) for r in db.execute("SELECT * FROM contacts").fetchall()]

@router.post("/contacts")
def create_contact(body: ContactCreate, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    cursor = db.execute("INSERT INTO contacts (name, type, address) VALUES (?,?,?)",
                        (body.name, body.type, body.address))
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
    return [dict(r) for r in db.execute("SELECT * FROM notification_rules").fetchall()]

@router.post("/rules")
def create_rule(body: RuleCreate, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    cursor = db.execute(
        "INSERT INTO notification_rules (contact_id, category, label, status_filter, time_start, time_end) VALUES (?,?,?,?,?,?)",
        (body.contact_id, body.category, body.label, body.status_filter, body.time_start, body.time_end)
    )
    db.commit()
    return {"id": cursor.lastrowid}

@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: sqlite3.Connection = Depends(get_db), _=Depends(require_auth)):
    db.execute("DELETE FROM notification_rules WHERE id = ?", (rule_id,))
    db.commit()
    return {"deleted": rule_id}
