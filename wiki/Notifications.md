# Notifications

Nomad Eye can send SMS notifications via Twilio and email notifications via SMTP. Notifications are triggered by rules — you define which detection categories, cameras, time windows, and frequency limits apply to each contact.

---

## Twilio SMS Setup

You need a Twilio account with an SMS-capable phone number.

1. Create an account at [twilio.com](https://www.twilio.com)
2. Get your **Account SID** and **Auth Token** from the Twilio Console
3. Get or buy a phone number in the Twilio Console

**In Nomad Eye:** Settings → Notifications → SMS (Twilio)

| Field | Where to find it |
|---|---|
| Account SID | Twilio Console → Account Info |
| Auth Token | Twilio Console → Account Info |
| From Number | Twilio Console → Phone Numbers (E.164 format, e.g. `+15551234567`) |

Click **Test SMS** to send a test message before saving.

---

## SMTP Email Setup

Any SMTP server works. Gmail, Outlook, and self-hosted servers are all supported.

**In Nomad Eye:** Settings → Notifications → Email (SMTP)

| Field | Description |
|---|---|
| SMTP Host | Your mail server hostname (e.g., `smtp.gmail.com`) |
| SMTP Port | Usually `587` (STARTTLS) or `465` (SSL) |
| Username | SMTP login username (usually your email address) |
| Password | SMTP login password or app password |
| From Address | The address that appears in the From field |

**Gmail note:** You must use an [App Password](https://support.google.com/accounts/answer/185833), not your regular Gmail password, if 2FA is enabled on your account.

Click **Send Test Email** to verify the connection before saving.

---

## Contacts

A contact is a person or destination that receives notifications. Each contact has a name, one or more delivery methods (SMS number or email address), and is referenced by notification rules.

**Notifications → Contacts → Add Contact**

| Field | Description |
|---|---|
| Name | Display name (e.g., "Casey", "Security Team") |
| SMS Number | Phone number in E.164 format (optional) |
| Email | Email address (optional) |

A contact can have both SMS and email — rules control which delivery method is used.

---

## Notification Rules

Rules determine when a notification is sent and to whom. Each rule is evaluated against every detection event.

**Notifications → Rules → Add Rule**

| Field | Description |
|---|---|
| Name | A label for the rule |
| Contacts | Which contacts to notify |
| Cameras | Which cameras trigger this rule (or "All") |
| Categories | Which detection categories trigger this rule (e.g., Person, Car) |
| Time window | Only fire during certain hours (e.g., 10 PM – 6 AM) |
| Min interval | Minimum minutes between notifications for this rule (prevents spam) |
| Delivery | SMS, Email, or Both |
| Enabled | Toggle the rule on/off without deleting it |

**Example rule:** "Notify Casey by SMS when a Person is detected on the Front Door camera, between 10 PM and 6 AM, no more than once every 10 minutes."

---

## Notification Content

Each notification includes:

- Camera name
- Detection category (and face name if recognized)
- Timestamp
- A direct link to the detection event in the web UI (uses `notification_url` from app_config — set this to your Tailscale IP for remote access links)

---

## Notification Log

**Notifications → Log** shows a history of all sent notifications, including delivery status (sent, failed) and the detection event that triggered each one. Useful for verifying rules are working or diagnosing delivery failures.
