import sqlite3
from pathlib import Path
from config.settings import get_settings

cfg = get_settings()

# synchronous=NORMAL under WAL is the SQLite-recommended pairing: durable across
# an app crash, only at risk of losing the last transaction on an OS crash / power
# loss (never corruption). On a flash-storage SBC that turns a full fsync per commit
# into far fewer, cutting write latency and card wear — worth it for a recorder.
def _tune(db):
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.execute("PRAGMA busy_timeout=10000")
    db.execute("PRAGMA cache_size=-8000")   # ~8 MB page cache (negative = KiB)
    db.execute("PRAGMA mmap_size=67108864") # 64 MB mmap, modest for a ~2 GB box

def get_db():
    db = sqlite3.connect(cfg.db_path, timeout=15, check_same_thread=False)
    db.row_factory = sqlite3.Row
    _tune(db)
    try:
        yield db
    finally:
        db.close()

def init_db():
    Path(cfg.db_path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(cfg.db_path)
    # Flip the DB into WAL at boot (persists in the file header) rather than
    # waiting for the first HTTP request — all the background writers that run
    # before/without any request then get WAL too.
    _tune(db)
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

        CREATE TABLE IF NOT EXISTS continuous_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            path TEXT NOT NULL,
            started_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS presence_devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            mac_address TEXT NOT NULL UNIQUE,
            active INTEGER DEFAULT 1,
            last_seen TEXT
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

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'operator', 'viewer')) DEFAULT 'viewer',
            created_at TEXT NOT NULL,
            last_login TEXT
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS camera_zones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            zone_type TEXT NOT NULL CHECK(zone_type IN ('include', 'exclude')),
            categories TEXT,
            points TEXT NOT NULL,
            created_at TEXT NOT NULL
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
    try:
        # detections is the fastest-growing table; the history API filters by
        # camera_id and orders by timestamp DESC. Without these it full-scans +
        # sorts the whole table on every page load.
        db.execute("CREATE INDEX IF NOT EXISTS idx_detections_ts ON detections (timestamp DESC)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_detections_camera_ts ON detections (camera_id, timestamp DESC)")
        db.commit()
    except sqlite3.OperationalError:
        pass
    try:
        db.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at)")
        db.commit()
    except sqlite3.OperationalError:
        pass
    try:
        db.execute("CREATE INDEX IF NOT EXISTS idx_camera_zones_camera ON camera_zones (camera_id)")
        db.commit()
    except sqlite3.OperationalError:
        pass
    try:
        db.execute("CREATE INDEX IF NOT EXISTS idx_continuous_segments_camera_created "
                    "ON continuous_segments (camera_id, created_at)")
        db.commit()
    except sqlite3.OperationalError:
        pass
    try:
        # created_at (above) serves the purge loop's oldest-first deletion; started_at
        # is a genuinely different sort key for the newest-first segment browser.
        db.execute("CREATE INDEX IF NOT EXISTS idx_continuous_segments_camera_started "
                    "ON continuous_segments (camera_id, started_at)")
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
        "ALTER TABLE cameras ADD COLUMN night_mode TEXT NOT NULL DEFAULT 'off'",
        "ALTER TABLE continuous_segments ADD COLUMN locked INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE continuous_segments ADD COLUMN size_bytes INTEGER",
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
        ('motion_scale',             '0.5'),
        ('detection_cooldown',       '3.0'),
        ('clips_primary_device',     ''),
        ('ntfy_server',              'https://ntfy.sh'),
        ('ntfy_token',               ''),
        ('ntfy_enabled',             '1'),
        ('ntfy_send_images',         '1'),
        ('presence_enabled',         '0'),
        ('presence_timeout',         '5'),
        ('presence_home_status',     'home'),
        ('presence_away_status',     'away'),
        ('notification_link_mode',   'local_ip'),
        ('notification_hostname',    ''),
        ('zones_enabled',            '0'),
        ('camera_health_alerts_enabled', '0'),
        ('continuous_recording_enabled', '0'),
    ]
    for key, value in defaults:
        db.execute(
            "INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)",
            (key, value)
        )
    db.commit()

    # Migrate contacts table to allow 'ntfy' type (recreate to change CHECK constraint)
    try:
        schema_row = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='contacts'"
        ).fetchone()
        if schema_row and 'ntfy' not in (schema_row[0] or ''):
            db.executescript("""
                CREATE TABLE contacts_v2 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL CHECK(type IN ('sms', 'email', 'ntfy')),
                    address TEXT NOT NULL,
                    carrier TEXT,
                    active INTEGER DEFAULT 1
                );
                INSERT INTO contacts_v2 SELECT id, name, type, address, carrier, active FROM contacts;
                DROP TABLE contacts;
                ALTER TABLE contacts_v2 RENAME TO contacts;
            """)
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

    # One-time migration: seed the first admin user from the legacy single-admin
    # credential (app_config, always plaintext pre-migration) or .env defaults.
    # Safe to re-run — only fires while the users table is still empty.
    try:
        from security import hash_password
        has_users = db.execute("SELECT 1 FROM users LIMIT 1").fetchone()
        if not has_users:
            legacy_user_row = db.execute("SELECT value FROM app_config WHERE key='admin_username'").fetchone()
            legacy_pass_row = db.execute("SELECT value FROM app_config WHERE key='admin_password'").fetchone()
            seed_username = legacy_user_row[0] if legacy_user_row and legacy_user_row[0] else cfg.admin_username
            seed_password = legacy_pass_row[0] if legacy_pass_row and legacy_pass_row[0] else cfg.admin_password
            db.execute(
                "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'admin', datetime('now'))",
                (seed_username, hash_password(seed_password))
            )
            db.commit()
    except Exception as e:
        # Not re-raised — a fresh install must still boot even if this migration has a
        # bug — but silent failure here means total lockout with zero diagnostic trail,
        # so at least surface it in the service log (journalctl -u nomad-eye-backend).
        print(f"WARNING: failed to seed initial admin user: {e}")

    db.close()
