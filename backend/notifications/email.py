import smtplib
import sqlite3
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from pathlib import Path
from config.settings import get_settings

cfg = get_settings()

async def send_email(to: str, subject: str, body: str, image_paths=None):
    db = sqlite3.connect(cfg.db_path)
    db.row_factory = sqlite3.Row
    smtp_host = db.execute("SELECT value FROM app_config WHERE key = ?", ("smtp_host",)).fetchone()
    if not smtp_host:
        return
    smtp_host = smtp_host["value"]
    smtp_port = int(db.execute("SELECT value FROM app_config WHERE key = ?", ("smtp_port",)).fetchone()["value"])
    smtp_user = db.execute("SELECT value FROM app_config WHERE key = ?", ("smtp_username",)).fetchone()["value"]
    smtp_pass = db.execute("SELECT value FROM app_config WHERE key = ?", ("smtp_password",)).fetchone()["value"]
    smtp_from_row = db.execute("SELECT value FROM app_config WHERE key = ?", ("smtp_from",)).fetchone()
    smtp_from = smtp_from_row["value"] if smtp_from_row else smtp_user
    db.close()

    # Normalise: accept a single path string or a list of paths
    if isinstance(image_paths, str):
        image_paths = [image_paths]
    elif not image_paths:
        image_paths = []

    msg = MIMEMultipart()
    msg["From"] = smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    for path in image_paths:
        if path and Path(path).exists():
            with open(path, "rb") as f:
                img = MIMEImage(f.read())
                img.add_header("Content-Disposition", "attachment", filename=Path(path).name)
                msg.attach(img)

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from, to, msg.as_string())
