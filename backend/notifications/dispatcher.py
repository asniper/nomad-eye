import json
import sqlite3
from datetime import datetime
from notifications.sms import send_sms
from notifications.email import send_email
from config.settings import get_settings

cfg = get_settings()

def _parse_json_list(val) -> list:
    if not val:
        return []
    try:
        return json.loads(val)
    except Exception:
        return [val]

async def dispatch_notification(camera_id: int, detections: list, image_path: str, ts: str):
    db = sqlite3.connect(cfg.db_path)
    db.row_factory = sqlite3.Row
    contacts = db.execute("SELECT * FROM contacts WHERE active = 1").fetchall()
    device_status = db.execute("SELECT status FROM device_status WHERE id = 1").fetchone()
    current_status = device_status["status"] if device_status else "home"
    current_time = datetime.utcnow().strftime("%H:%M")

    for contact in contacts:
        rules = db.execute(
            "SELECT * FROM notification_rules WHERE contact_id = ? AND active = 1",
            (contact["id"],)
        ).fetchall()

        for rule in rules:
            allowed_statuses = _parse_json_list(rule["device_statuses"])
            if allowed_statuses and current_status not in allowed_statuses:
                continue

            if rule["time_start"] and rule["time_end"]:
                if not (rule["time_start"] <= current_time <= rule["time_end"]):
                    continue

            allowed_categories = _parse_json_list(rule["categories"])
            allowed_labels = _parse_json_list(rule["labels"])

            matching = [
                d for d in detections
                if (not allowed_categories or d.category in allowed_categories)
                and (not allowed_labels or d.label in allowed_labels)
            ]
            if not matching:
                continue

            labels = ", ".join(set(d.label for d in matching))
            message = (
                f"Nomad Eye Alert\n"
                f"Camera: {camera_id}\n"
                f"Detected: {labels}\n"
                f"Time: {ts}\n"
            )
            if contact["type"] == "sms":
                await send_sms(contact["address"], message, image_path)
            elif contact["type"] == "email":
                await send_email(contact["address"], "Nomad Eye Alert", message, image_path)

    db.close()
