import json
import socket
import sqlite3
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from notifications.sms import send_sms
from notifications.email import send_email
from config.settings import get_settings

cfg = get_settings()

FREQUENCY_SECONDS = {
    'instant': 0,
    '15min': 900,
    '30min': 1800,
    'hourly': 3600,
    'daily': 86400,
}


def _parse_json_list(val) -> list:
    if not val:
        return []
    try:
        return json.loads(val)
    except Exception:
        return [val]


def _format_ts(ts: str, tz_name: str) -> str:
    try:
        tz = ZoneInfo(tz_name) if tz_name and tz_name != 'UTC' else timezone.utc
        dt = datetime.fromisoformat(ts).astimezone(tz)
    except (ZoneInfoNotFoundError, ValueError):
        dt = datetime.fromisoformat(ts).astimezone(timezone.utc)
    hour = dt.strftime("%I").lstrip("0") or "12"
    day = str(dt.day)
    return dt.strftime(f"%a %b {day} at {hour}:%M %p")


def _write_log(camera_id, contact, event_id, labels, message, status, err):
    log_db = sqlite3.connect(cfg.db_path)
    log_db.execute(
        """INSERT INTO notification_log
           (timestamp, contact_id, contact_name, channel, address, camera_id,
            event_id, labels, message, status, error)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (datetime.now(timezone.utc).isoformat(), contact["id"], contact["name"],
         contact["type"], contact["address"], camera_id, event_id, labels, message, status, err)
    )
    log_db.commit()
    log_db.close()


async def _send_contact(contact, message, labels, image_path, click_url=None, primary_category=None):
    if contact["type"] == "sms":
        await send_sms(contact["address"], contact["carrier"] or "", message, None)
    elif contact["type"] == "email":
        await send_email(contact["address"], f"Nomad Eye: {labels}", message, image_path)
    elif contact["type"] == "ntfy":
        from notifications.ntfy import send_ntfy
        await send_ntfy(contact["address"], message, title=f"Nomad Eye: {labels}",
                        click_url=click_url, category=primary_category)


def _parse_last_notified(last_str):
    if not last_str:
        return None
    try:
        dt = datetime.fromisoformat(last_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


async def dispatch_notification(camera_id: int, detections: list, image_path: str, ts: str, event_id: str = None):
    db = sqlite3.connect(cfg.db_path)
    db.row_factory = sqlite3.Row

    name_row = db.execute("SELECT value FROM app_config WHERE key=?", (f"camera_name_{camera_id}",)).fetchone()
    camera_name = name_row["value"] if name_row else f"Camera {camera_id}"

    internal_url = f"http://{socket.gethostname()}"
    ext_row = db.execute(
        "SELECT value FROM app_config WHERE key IN ('external_url','app_base_url') ORDER BY key='external_url' DESC LIMIT 1"
    ).fetchone()
    notification_url = ext_row["value"].rstrip("/") if (ext_row and ext_row["value"]) else internal_url

    tz_row = db.execute("SELECT value FROM app_config WHERE key='timezone'").fetchone()
    tz_name = tz_row["value"] if tz_row else "UTC"

    ntfy_enabled_row = db.execute("SELECT value FROM app_config WHERE key='ntfy_enabled'").fetchone()
    ntfy_enabled = (ntfy_enabled_row["value"] if ntfy_enabled_row else "1") != "0"

    time_str = _format_ts(ts, tz_name)
    event_link = f"{notification_url}/events/{event_id}" if event_id else None

    contacts = db.execute("SELECT * FROM contacts WHERE active = 1").fetchall()
    device_status = db.execute("SELECT status FROM device_status WHERE id = 1").fetchone()
    current_status = device_status["status"] if device_status else "home"
    current_time = datetime.now(timezone.utc).strftime("%H:%M")
    now_dt = datetime.now(timezone.utc)

    for contact in contacts:
        if contact["type"] == "ntfy" and not ntfy_enabled:
            continue

        rules = db.execute(
            "SELECT * FROM notification_rules WHERE contact_id = ? AND active = 1",
            (contact["id"],)
        ).fetchall()

        for rule in rules:
            rule_dict = dict(rule)

            allowed_statuses = _parse_json_list(rule_dict.get("device_statuses"))
            if allowed_statuses and current_status not in allowed_statuses:
                continue
            if rule_dict.get("time_start") and rule_dict.get("time_end"):
                if not (rule_dict["time_start"] <= current_time <= rule_dict["time_end"]):
                    continue
            allowed_categories = _parse_json_list(rule_dict.get("categories"))
            allowed_labels = _parse_json_list(rule_dict.get("labels"))
            matching = [
                d for d in detections
                if (not allowed_categories or d.category in allowed_categories)
                and (not allowed_labels or d.label in allowed_labels)
            ]
            if not matching:
                continue

            _PRIORITY = {"people": 0, "faces": 1, "vehicles": 2, "animals": 3, "other": 4}

            def _fmt_detection(d):
                pct = round(d.confidence * 100)
                if d.category == 'faces':
                    return f"Face ({d.label} {pct}%)"
                return f"{d.label} ({pct}%)"

            unique = {_fmt_detection(d): d for d in matching}
            labels = ", ".join(
                t for t, d in sorted(unique.items(), key=lambda x: _PRIORITY.get(x[1].category, 4))
            )
            primary_category = min(matching, key=lambda d: _PRIORITY.get(d.category, 4)).category
            lines = ["Nomad Eye Alert", f"{camera_name} · {time_str}", f"Detected: {labels}"]
            if event_link:
                lines.append(f"View: {event_link}")
            message = "\n".join(lines)

            freq = rule_dict.get("frequency") or "instant"
            freq_secs = FREQUENCY_SECONDS.get(freq, 0)

            if freq_secs == 0:
                err = None
                try:
                    await _send_contact(contact, message, labels, image_path,
                                        click_url=event_link, primary_category=primary_category)
                    status = "sent"
                except Exception as exc:
                    status = "failed"
                    err = str(exc)
                _write_log(camera_id, contact, event_id, labels, message, status, err)

            else:
                last_dt = _parse_last_notified(rule_dict.get("last_notified_at"))
                elapsed = (now_dt - last_dt).total_seconds() if last_dt else float('inf')

                if elapsed >= freq_secs:
                    err = None
                    try:
                        await _send_contact(contact, message, labels, image_path,
                                            click_url=event_link, primary_category=primary_category)
                        status = "sent"
                    except Exception as exc:
                        status = "failed"
                        err = str(exc)
                    _write_log(camera_id, contact, event_id, labels, message, status, err)
                    upd = sqlite3.connect(cfg.db_path)
                    upd.execute("UPDATE notification_rules SET last_notified_at = ? WHERE id = ?",
                                (now_dt.isoformat(), rule_dict["id"]))
                    upd.commit()
                    upd.close()
                else:
                    scheduled_dt = last_dt + timedelta(seconds=freq_secs)
                    new_event = {
                        "event_id": event_id,
                        "labels": labels,
                        "camera_id": camera_id,
                        "camera_name": camera_name,
                        "timestamp": ts,
                        "image_path": image_path if contact["type"] == "email" else None,
                    }
                    q_db = sqlite3.connect(cfg.db_path)
                    q_db.row_factory = sqlite3.Row
                    existing = q_db.execute(
                        "SELECT * FROM notification_queue WHERE rule_id = ?",
                        (rule_dict["id"],)
                    ).fetchone()
                    if existing:
                        try:
                            events = json.loads(existing["events_json"] or "[]")
                        except Exception:
                            events = []
                        events.append(new_event)
                        q_db.execute(
                            "UPDATE notification_queue SET events_json = ?, queued_at = ? WHERE rule_id = ?",
                            (json.dumps(events), now_dt.isoformat(), rule_dict["id"])
                        )
                    else:
                        q_db.execute(
                            """INSERT INTO notification_queue
                               (rule_id, contact_id, contact_name, channel, address, carrier,
                                camera_id, event_id, labels, message, image_path,
                                queued_at, scheduled_for, events_json)
                               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (rule_dict["id"], contact["id"], contact["name"], contact["type"],
                             contact["address"], contact["carrier"],
                             camera_id, event_id, labels, "",
                             new_event["image_path"], now_dt.isoformat(),
                             scheduled_dt.isoformat(), json.dumps([new_event]))
                        )
                    q_db.commit()
                    q_db.close()

    db.close()
