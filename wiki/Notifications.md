# Notifications

Nomad Eye can send push notifications via ntfy, SMS via Twilio or carrier email gateway, and email via SMTP. Notifications are triggered by rules — you define which detection categories, device statuses, time windows, and frequency limits apply to each contact.

---

## ntfy Push Notifications (Recommended)

[ntfy](https://ntfy.sh) is a free, open-source push notification service. The free ntfy.sh cloud service requires no account for basic use. You can also self-host it.

### Setup

1. Install the **ntfy** app on your phone ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy))
2. Subscribe to a topic name you choose (e.g., `nomad-eye-alerts-abc123`)
   - Use a random-enough topic name — anyone who knows the topic can read it on the free tier
   - For private topics, use an access token (see below)
3. In Nomad Eye, go to **Settings → ntfy Push Notifications** and verify the server URL (`https://ntfy.sh` by default)
4. Go to **Notifications → Contacts → Add Contact**, choose type **ntfy**, and enter your topic name
5. Add a notification rule for that contact

That's it. No account, no API key, no monthly fee.

### Settings → ntfy Push Notifications

| Field | Description |
|---|---|
| Server URL | Base URL of your ntfy server. Default: `https://ntfy.sh`. Change this for a self-hosted server (e.g., `https://ntfy.example.com`). |
| Access Token | Optional. Required for private topics on ntfy.sh or authenticated self-hosted servers. Leave blank for public topics. |

### Private topics

To use a private topic on ntfy.sh:
1. Create a free account at [ntfy.sh](https://ntfy.sh)
2. Generate an access token in your account settings
3. Enter the token in **Settings → ntfy Push Notifications → Access Token**
4. Subscribe to the topic in the ntfy app using your account

### Priority levels

Nomad Eye automatically sets the ntfy notification priority based on what was detected:

| Detection | Priority |
|---|---|
| People, Faces | High |
| Vehicles, Animals, Other | Default |

---

## Twilio SMS

You need a Twilio account with an SMS-capable phone number. Note: Twilio requires A2P 10DLC campaign registration for US numbers, which adds setup overhead.

**In Nomad Eye:** Settings → SMS → Provider: Twilio

| Field | Where to find it |
|---|---|
| Account SID | Twilio Console → Account Info |
| Auth Token | Twilio Console → Account Info |
| From Number | Twilio Console → Phone Numbers (E.164 format, e.g. `+15551234567`) |

---

## Email Gateway SMS (Free)

Send SMS via your carrier's free email-to-SMS gateway. No API key required — uses your existing SMTP configuration.

**In Nomad Eye:** Settings → SMS → Provider: Email Gateway

When creating an SMS contact, select the recipient's carrier. Nomad Eye will format the address as `number@carrier-gateway.com`.

| Carrier | Gateway |
|---|---|
| AT&T | `txt.att.net` |
| T-Mobile | `tmomail.net` |
| Verizon | `vzwpix.com` |
| Sprint | `messaging.sprintpcs.com` |
| Boost | `sms.myboostmobile.com` |
| Cricket | `sms.cricketwireless.net` |
| US Cellular | `email.uscc.net` |
| Metro by T-Mobile | `mymetropcs.com` |

Requires SMTP to be configured (Settings → Email).

---

## SMTP Email

Any SMTP server works — Gmail, Outlook, or self-hosted.

**In Nomad Eye:** Settings → Email (SMTP)

| Field | Description |
|---|---|
| SMTP Host | Mail server hostname (e.g., `smtp.gmail.com`) |
| SMTP Port | Usually `587` (STARTTLS) or `465` (SSL) |
| Username | SMTP login (usually your email address) |
| Password | SMTP password or app password |
| From Address | Appears in the From field |

**Gmail:** Use an [App Password](https://support.google.com/accounts/answer/185833) if 2FA is enabled.

---

## Contacts

A contact is a destination for notifications. Each contact has a name, a type (ntfy, SMS, or email), and an address (ntfy topic, phone number, or email).

**Notifications → Contacts → Add Contact**

| Type | Address field |
|---|---|
| ntfy | Topic name (e.g., `nomad-eye-alerts`) |
| SMS | Phone number in E.164 format (e.g., `+15551234567`) |
| Email | Email address |

---

## Notification Rules

Rules determine when and to whom notifications are sent. Each rule is evaluated against every detection event.

**Notifications → Rules → Add Rule**

| Field | Description |
|---|---|
| Contact | Which contact to notify |
| Categories | Which detection categories trigger this rule (empty = all) |
| Device statuses | Only fire when device is in these statuses (empty = all) |
| Time window | Only fire during certain hours |
| Frequency | Instant, every 15 min, 30 min, hourly, or daily |

**Example:** "Notify me on ntfy when a person is detected, only when status is Away or Vacation, between 10 PM and 6 AM, no more than once every 15 minutes."

---

## Notification Content

Each notification includes:

- Camera name
- Detection label and confidence
- Timestamp
- A direct link to the detection event in the web UI (controlled by Settings → General → Notification Links — set the link mode to Tailscale IP so this link works from anywhere, see [Remote Access](Remote-Access))

ntfy notifications also set a **priority** (high for people/faces, default for everything else) and a **click action** that opens the event directly.

---

## Notification Log

**Notifications → Log** shows a history of the last 50 notifications sent, including channel, delivery status, and the detection that triggered each one. Useful for verifying rules are working or diagnosing delivery failures.
