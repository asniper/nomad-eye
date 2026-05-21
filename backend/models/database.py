import sqlite3
from pathlib import Path
from config.settings import get_settings

cfg = get_settings()

def get_db():
    db = sqlite3.connect(cfg.db_path)
    db.row_factory = sqlite3.Row
    try:
        yield db
    finally:
        db.close()

def init_db():
    Path(cfg.db_path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(cfg.db_path)
    cursor = db.cursor()
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS detections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            label TEXT NOT NULL,
            confidence REAL NOT NULL,
            image_path TEXT,
            clip_path TEXT,
            timestamp TEXT NOT NULL,
            notified INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('sms', 'email')),
            address TEXT NOT NULL,
            active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS notification_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contact_id INTEGER NOT NULL,
            categories TEXT,
            labels TEXT,
            device_statuses TEXT,
            time_start TEXT,
            time_end TEXT,
            active INTEGER DEFAULT 1,
            FOREIGN KEY (contact_id) REFERENCES contacts(id)
        );

        CREATE TABLE IF NOT EXISTS networks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ssid TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            last_connected TEXT,
            auto_connect INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS device_status (
            id INTEGER PRIMARY KEY DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'home'
        );

        INSERT OR IGNORE INTO device_status (id, status) VALUES (1, 'home');

        CREATE TABLE IF NOT EXISTS app_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    """)
    db.commit()
    db.close()
