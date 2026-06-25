import asyncio
import json
import socket
import sqlite3
import threading
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from config.settings import get_settings

cfg = get_settings()


def _format_ts(ts: str, tz_name: str) -> str:
    try:
        tz = ZoneInfo(tz_name) if tz_name and tz_name != 'UTC' else timezone.utc
        dt = datetime.fromisoformat(ts).astimezone(tz)
    except (ZoneInfoNotFoundError, ValueError):
        dt = datetime.fromisoformat(ts).astimezone(timezone.utc)
    hour = dt.strftime("%I").lstrip("0") or "12"
    day = str(dt.day)
    return dt.strftime(f"%a %b {day} at {hour}:%M %p")


def _build_message(item, base_url: str, tz_name: str) -> tuple:
    """Returns (subject, message, combined_labels, last_event_id)."""
    try:
        events = json.loads(item["events_json"] or "[]")
    except Exception:
        events = []

    if not events:
        msg = item["message"] or "Nomad Eye Alert"
        return f"Nomad Eye: {item['labels'] or 'Alert'}", msg, item["labels"] or "", item["event_id"]

    last_event_id = events[-1].get("event_id")

    # Collect all unique label tokens across events for the subject line
    all_label_tokens = sorted(set(
        tok.strip()
        for e in events
        for tok in e["labels"].split(",")
        if tok.strip()
    ))
    combined_labels = ", ".join(all_label_tokens)

    if len(events) == 1:
        e = events[0]
        lines = [
            "Nomad Eye Alert",
            f"{e['camera_name']} · {_format_ts(e['timestamp'], tz_name)}",
            f"Detected: {e['labels']}",
        ]
        if base_url and e.get("event_id"):
            lines.append(f"View: {base_url}/events/{e['event_id']}")
        subject = f"Nomad Eye: {e['labels']}"
        return subject, "\n".join(lines), combined_labels, last_event_id

    # Multiple events — build combined message
    subject = f"Nomad Eye: {len(events)} events detected"
    lines = [f"Nomad Eye Alert — {len(events)} events"]
    for e in events:
        lines.append("")
        lines.append(f"{e['camera_name']} · {_format_ts(e['timestamp'], tz_name)}")
        lines.append(f"Detected: {e['labels']}")
        if base_url and e.get("event_id"):
            lines.append(f"View: {base_url}/events/{e['event_id']}")

    return subject, "\n".join(lines), combined_labels, last_event_id


def _process_due_items():
    db = sqlite3.connect(cfg.db_path)
    db.row_factory = sqlite3.Row
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    # Purge queued items for disabled contacts or rules so they never fire.
    db.execute(
        """DELETE FROM notification_queue
           WHERE contact_id IN (SELECT id FROM contacts WHERE active = 0)
              OR rule_id IN (SELECT id FROM notification_rules WHERE active = 0)"""
    )
    db.commit()

    pending = db.execute(
        """SELECT nq.* FROM notification_queue nq
           JOIN contacts c ON nq.contact_id = c.id
           JOIN notification_rules nr ON nq.rule_id = nr.id
           WHERE nq.scheduled_for <= ?
             AND c.active = 1
             AND nr.active = 1""",
        (now_iso,)
    ).fetchall()

    if not pending:
        db.close()
        return

    internal_url = f"http://{socket.gethostname()}"
    ext_row = db.execute(
        "SELECT value FROM app_config WHERE key IN ('external_url','app_base_url') ORDER BY key='external_url' DESC LIMIT 1"
    ).fetchone()
    base_url = ext_row["value"].rstrip("/") if (ext_row and ext_row["value"]) else internal_url
    tz_row = db.execute("SELECT value FROM app_config WHERE key='timezone'").fetchone()
    tz_name = tz_row["value"] if tz_row else "UTC"

    for item in pending:
        subject, message, log_labels, log_event_id = _build_message(item, base_url, tz_name)

        image_paths = None
        if item["channel"] == "email":
            try:
                events = json.loads(item["events_json"] or "[]")
                paths = [e.get("image_path") for e in events if e.get("image_path")]
                image_paths = paths if paths else None
            except Exception:
                image_paths = [item["image_path"]] if item["image_path"] else None

        status = "sent"
        err = None
        try:
            from notifications.sms import send_sms
            from notifications.email import send_email
            from notifications.ntfy import send_ntfy
            if item["channel"] == "sms":
                asyncio.run(send_sms(item["address"], item["carrier"] or "", message, None))
            elif item["channel"] == "email":
                asyncio.run(send_email(item["address"], subject, message, image_paths))
            elif item["channel"] == "ntfy":
                click_url = f"{base_url}/events/{log_event_id}" if (base_url and log_event_id) else None
                asyncio.run(send_ntfy(item["address"], message, title=subject, click_url=click_url))
        except Exception as exc:
            status = "failed"
            err = str(exc)

        db.execute("DELETE FROM notification_queue WHERE id = ?", (item["id"],))

        if status == "sent":
            db.execute(
                "UPDATE notification_rules SET last_notified_at = ? WHERE id = ?",
                (now_iso, item["rule_id"])
            )

        db.execute(
            """INSERT INTO notification_log
               (timestamp, contact_id, contact_name, channel, address, camera_id,
                event_id, labels, message, status, error)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (now_iso, item["contact_id"], item["contact_name"], item["channel"],
             item["address"], item["camera_id"], log_event_id, log_labels,
             message, status, err)
        )
        db.commit()

    db.close()


class QueueProcessor:
    def __init__(self):
        self._running = False
        self._thread = None

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    def _run(self):
        while self._running:
            try:
                _process_due_items()
            except Exception:
                pass
            time.sleep(60)
