import sqlite3
from pathlib import Path
from config.settings import get_settings

cfg = get_settings()

def get_db():
    db = sqlite3.connect(cfg.db_path, timeout=15, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=10000")
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
            notified INTEGER DEFAULT 0,
            event_id TEXT
        );

        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('sms', 'email')),
            address TEXT NOT NULL,
            carrier TEXT,
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

        CREATE TABLE IF NOT EXISTS notification_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_id INTEGER NOT NULL UNIQUE,
            contact_id INTEGER,
            contact_name TEXT,
            channel TEXT NOT NULL,
            address TEXT NOT NULL,
            carrier TEXT,
            camera_id INTEGER,
            event_id TEXT,
            labels TEXT,
            message TEXT,
            image_path TEXT,
            queued_at TEXT NOT NULL,
            scheduled_for TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS event_clips (
            event_id TEXT PRIMARY KEY,
            clip_path TEXT NOT NULL,
            camera_id INTEGER,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notification_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            contact_id INTEGER,
            contact_name TEXT,
            channel TEXT NOT NULL,
            address TEXT NOT NULL,
            camera_id INTEGER,
            event_id TEXT,
            labels TEXT,
            message TEXT,
            status TEXT NOT NULL,
            error TEXT
        );
    """)
    db.commit()
    try:
        db.execute("CREATE INDEX IF NOT EXISTS idx_notif_log_ts ON notification_log (timestamp DESC)")
        db.commit()
    except sqlite3.OperationalError:
        pass
    try:
        db.execute("CREATE INDEX IF NOT EXISTS idx_detections_event_conf ON detections (event_id, confidence DESC)")
        db.commit()
    except sqlite3.OperationalError:
        pass
    # Cameras table for stable USB-based identity across reboots
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS cameras (
            camera_id INTEGER PRIMARY KEY,
            usb_id    TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    db.commit()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS known_faces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT 'Unknown',
            encoding BLOB NOT NULL,
            image_path TEXT,
            created_at TEXT NOT NULL
        );
    """)
    db.commit()

    for migration in [
        "ALTER TABLE cameras ADD COLUMN name TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE cameras ADD COLUMN last_seen TEXT",
        "ALTER TABLE detections ADD COLUMN event_id TEXT",
        "ALTER TABLE contacts ADD COLUMN carrier TEXT",
        "ALTER TABLE notification_log ADD COLUMN message TEXT",
        "ALTER TABLE notification_rules ADD COLUMN frequency TEXT DEFAULT 'instant'",
        "ALTER TABLE notification_rules ADD COLUMN last_notified_at TEXT",
        "ALTER TABLE notification_queue ADD COLUMN events_json TEXT",
        "ALTER TABLE cameras ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE cameras ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE cameras ADD COLUMN hw_adjustments TEXT NOT NULL DEFAULT '{}'",
        "ALTER TABLE cameras ADD COLUMN sw_brightness INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE cameras ADD COLUMN sw_contrast REAL NOT NULL DEFAULT 1.0",
        "ALTER TABLE cameras ADD COLUMN face_detection_enabled INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE cameras ADD COLUMN face_sensitivity TEXT NOT NULL DEFAULT 'normal'",
    ]:
        try:
            db.execute(migration)
            db.commit()
        except sqlite3.OperationalError:
            pass
    # Seed default config values for fresh installs. INSERT OR IGNORE leaves existing values untouched.
    defaults = [
        ('confidence_people',        '0.80'),
        ('confidence_vehicles',      '0.80'),
        ('confidence_animals',       '0.80'),
        ('confidence_other',         '0.80'),
        ('confidence_faces',         '0.80'),
        ('motion_threshold',         '100'),
        ('category_enabled_people',  '1'),
        ('category_enabled_vehicles','1'),
        ('category_enabled_animals', '1'),
        ('category_enabled_other',   '1'),
        ('category_enabled_faces',   '0'),
        ('update_channel',           'main'),
        ('auto_update_enabled',      '0'),
        ('clips_enabled',            '0'),
        ('clips_pre_roll',           '5'),
        ('clips_post_roll',          '10'),
        ('clips_purge_mode',         'pct'),
        ('clips_purge_threshold',    '90'),
    ]
    for key, value in defaults:
        db.execute(
            "INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)",
            (key, value)
        )
    db.commit()

    # Migrate update_channel from 'releases' to 'main' — we don't publish release tags
    try:
        db.execute(
            "UPDATE app_config SET value='main' WHERE key='update_channel' AND value='releases'"
        )
        db.commit()
    except Exception:
        pass

    # Migrate camera names from app_config into cameras.name (one-time, safe to re-run)
    try:
        db.execute("""
            UPDATE cameras SET name = (
                SELECT value FROM app_config WHERE key = 'camera_name_' || cameras.camera_id
            ) WHERE name = '' AND EXISTS (
                SELECT 1 FROM app_config WHERE key = 'camera_name_' || cameras.camera_id
            )
        """)
        db.commit()
    except Exception:
        pass
    db.close()
