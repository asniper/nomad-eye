import sqlite3
from datetime import datetime
from notifications.sms import send_sms
from notifications.email import send_email
from config.settings import get_settings

cfg = get_settings()

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
            if rule["status_filter"] and rule["status_filter"] != current_status:
                continue
            if rule["time_start"] and rule["time_end"]:
                if not (rule["time_start"] <= current_time <= rule["time_end"]):
                    continue
            matching = [
                d for d in detections
                if (not rule["category"] or d.category == rule["category"])
                and (not rule["label"] or d.label == rule["label"])
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
