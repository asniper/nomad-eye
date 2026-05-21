from twilio.rest import Client
from config.settings import get_settings
import sqlite3

cfg = get_settings()

async def send_sms(to: str, message: str, image_path: str = None):
    db = sqlite3.connect(cfg.db_path)
    db.row_factory = sqlite3.Row
    row = db.execute("SELECT value FROM app_config WHERE key = ?", ("twilio_account_sid",)).fetchone()
    if not row:
        return
    account_sid = row["value"]
    auth_token = db.execute("SELECT value FROM app_config WHERE key = ?", ("twilio_auth_token",)).fetchone()["value"]
    from_number = db.execute("SELECT value FROM app_config WHERE key = ?", ("twilio_from_number",)).fetchone()["value"]
    db.close()
    client = Client(account_sid, auth_token)
    client.messages.create(to=to, from_=from_number, body=message)
