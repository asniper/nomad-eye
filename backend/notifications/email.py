import smtplib
import sqlite3
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from pathlib import Path
from config.settings import get_settings

cfg = get_settings()

async def send_email(to: str, subject: str, body: str, image_path: str = None):
    db = sqlite3.connect(cfg.db_path)
    db.row_factory = sqlite3.Row
    smtp_host = db.execute("SELECT value FROM app_config WHERE key = ?", ("smtp_host",)).fetchone()
    if not smtp_host:
        return
    smtp_host = smtp_host["value"]
    smtp_port = int(db.execute("SELECT value FROM app_config WHERE key = ?", ("smtp_port",)).fetchone()["value"])
    smtp_user = db.execute("SELECT value FROM app_config WHERE key = ?", ("smtp_user",)).fetchone()["value"]
    smtp_pass = db.execute("SELECT value FROM app_config WHERE key = ?", ("smtp_pass",)).fetchone()["value"]
    db.close()

    msg = MIMEMultipart()
    msg["From"] = smtp_user
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    if image_path and Path(image_path).exists():
        with open(image_path, "rb") as f:
            img = MIMEImage(f.read())
            img.add_header("Content-Disposition", "attachment", filename=Path(image_path).name)
            msg.attach(img)

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_user, to, msg.as_string())
