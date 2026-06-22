from twilio.rest import Client
from config.settings import get_settings
import sqlite3

cfg = get_settings()

CARRIER_GATEWAYS = {
    'att':        'txt.att.net',
    'tmobile':    'tmomail.net',
    'verizon':    'vzwpix.com',
    'sprint':     'messaging.sprintpcs.com',
    'boost':      'sms.myboostmobile.com',
    'cricket':    'sms.cricketwireless.net',
    'us_cellular':'email.uscc.net',
    'metro':      'mymetropcs.com',
}

async def send_sms(to: str, carrier: str, message: str, image_path: str = None):
    db = sqlite3.connect(cfg.db_path)
    db.row_factory = sqlite3.Row
    provider_row = db.execute("SELECT value FROM app_config WHERE key = 'sms_provider'").fetchone()
    provider = provider_row['value'] if provider_row else 'twilio'

    if provider == 'email_gateway':
        domain = CARRIER_GATEWAYS.get(carrier or '')
        if not domain:
            db.close()
            return
        digits = ''.join(c for c in to if c.isdigit())
        gateway_addr = f"{digits}@{domain}"
        db.close()
        from notifications.email import send_email
        await send_email(gateway_addr, 'Nomad Eye', message, image_path)
    else:
        rows = db.execute(
            "SELECT key, value FROM app_config WHERE key IN ('twilio_account_sid','twilio_auth_token','twilio_from_number')"
        ).fetchall()
        vals = {r['key']: r['value'] for r in rows}
        db.close()
        if not vals.get('twilio_account_sid') or not vals.get('twilio_auth_token') or not vals.get('twilio_from_number'):
            raise ValueError("Twilio not configured — set Account SID, Auth Token, and From Number in Settings")
        client = Client(vals['twilio_account_sid'], vals['twilio_auth_token'])
        client.messages.create(to=to, from_=vals['twilio_from_number'], body=message)
