# Users & Roles

Nomad Eye supports multiple logins with different permission levels, instead of one shared admin password.

---

## Roles

| Role | Can do |
|---|---|
| `admin` | Everything — including managing other users, network/Tailscale, storage, system settings, and the AI/detection model. |
| `operator` | Day-to-day camera work: enable/disable and reload cameras, manage the face library, manage notification contacts and rules, delete/purge detections and clips, manage presence-detection watched devices. No access to network, storage, system, or detection-model settings. |
| `viewer` | Read-only. Can view live streams, browse detections and clips, and change their own password. Can also set the device status (home/away/sleep/vacation) — that's treated as a shared household convenience, not an administrative action. |

A role change takes effect on that user's **very next request** — the server always enforces the current role. Their browser won't show the right tabs/buttons for it until they log out and back in, since the UI reads the role it cached at login.

---

## Managing Users

**Settings → Users** (admin only)

- **Add a user**: enter a username, password (8+ characters), and role, then click **Add**.
- **Change a role**: pick a new role from the dropdown next to that user — takes effect immediately server-side.
- **Reset a password**: click **Reset password** on a user's row. This also signs that user out of every device they were logged in on.
- **Delete a user**: click **Delete**, then **Confirm delete**. You can't delete your own account while logged in as it, and you can't delete or demote the last remaining admin — both are blocked so you can't lock yourself out of the app.

## Changing Your Own Password

Every role can change their own password from the account menu at the bottom of the sidebar (click your username, then **Change password**). This requires your current password and signs you out afterward, on every device — if a session token were ever compromised, changing your password immediately invalidates it rather than leaving it usable.

---

## Upgrading From an Older Version

Versions before this feature had a single shared admin login (`admin_username`/`admin_password` in Settings → System, stored as plaintext). On first startup after upgrading, Nomad Eye automatically:

1. Creates the new `users` table.
2. Seeds one `admin` account from whatever credentials were already in use — your existing username/password if you'd changed them, or the documented `admin`/`nomadeye` defaults if you hadn't.
3. Hashes that password properly (PBKDF2-HMAC-SHA256) — it's never stored in plaintext again.

No action is needed — log in with the same credentials as before. From there, add more users from Settings → Users if you want separate logins for other people.

**One side effect:** every browser that was already logged in gets signed out once after this upgrade (the old session mechanism — HTTP Basic Auth resent on every request — is replaced with proper session tokens). Just log back in with the same credentials.

---

## Technical Notes

- Sessions last 30 days and silently renew if you're still active within 5 days of expiring — you won't get logged out just from leaving the tab open.
- Passwords are hashed with PBKDF2-HMAC-SHA256 (260,000 iterations, random salt per password) using Python's standard library — no extra native dependency to install.
- The live camera stream (a WebSocket connection) authenticates the same session token via a query parameter, since browsers can't attach an `Authorization` header to a WebSocket handshake.
