# Presence Detection

Nomad Eye can automatically change the device status (Home, Away, Sleep, Vacation) based on whether specific devices are detected on the local network. When your phone disappears from the network, status switches to Away; when it comes back, it switches to Home — no app required on the tracked device.

---

## How it works

Every 30 seconds, Nomad Eye runs `arp-scan` to get a list of all devices on the local network. If any of your watched devices are found, the "last seen" timestamp for that device is updated. If the most recent ping for all watched devices is older than your configured timeout, the status switches to your Away status. As soon as any watched device appears again, status switches back to Home.

This is purely network-based — it requires the tracked device to be connected to the same Wi-Fi network as the Nomad Eye device.

---

## Setup

**Settings → General → Presence Detection**

1. Enable the toggle.
2. Set your **away timeout** — how many minutes without a ping before switching to Away. 5 minutes is a good default; use 2 for faster response.
3. Configure the **status mapping**: what status to set when a device is detected, and what to set when it's not.
4. Add watched devices (see below).

---

## Adding devices

### Scan the network (easiest)

1. Click **Scan network** — Nomad Eye scans the local network and lists all connected devices with IP, MAC address, and hardware vendor.
2. Find your device in the list. Your phone's MAC can also be found in your phone's Wi-Fi settings.
3. Click **Add** next to the device, give it a name, and save.

### Manual entry

Click **+ Add device manually** and enter:
- **Name** — any label, e.g. "Casey's iPhone"
- **MAC address** — the device's MAC address in `XX:XX:XX:XX:XX:XX` format

**Finding your MAC address:**
- **iPhone/iPad:** Settings → Wi-Fi → tap your network → Wi-Fi Address
- **Android:** Settings → About phone → Status → Wi-Fi MAC address (or Settings → Network → Wi-Fi → tap your network → MAC address)
- **Mac:** System Settings → Wi-Fi → Details → Hardware Address
- **Windows:** Settings → Network → Wi-Fi → Properties → Physical address

---

## MAC address privacy (important)

Modern iOS (14+) and Android devices use **private Wi-Fi addresses** — a randomized MAC per network. This random MAC is stable for a given Wi-Fi network (it doesn't change every connection), so presence detection works correctly. Just add the MAC that shows in the scan or in your phone's Wi-Fi settings for your home network — it will be consistent.

If you replace your phone, add the new device and optionally remove the old one.

---

## Multiple devices

You can add as many devices as you want. The status switches to Home if **any** watched device is present, and switches to Away only when **all** watched devices have been absent longer than the timeout. This works well for households — if any family member's phone is present, status stays Home.

---

## Notification rules with presence

Presence detection is most powerful when combined with notification rules. Example:

- Set status to **Home** when present, **Away** when not.
- Create a notification rule that only fires when status is **Away**.
- Result: you only get alerts when you're away from home.

See [Notifications](Notifications.md) for rule setup.

---

## Troubleshooting

**Scan returns no devices**
- Ensure `arp-scan` is installed: `apt install arp-scan`
- The service runs as the `nomadeye` user — `arp-scan` requires root and is called via the `storage-helper.sh` sudo wrapper. Check that the wrapper is in place: `ls -la /opt/nomad-eye/storage-helper.sh`

**Status not changing**
- Confirm presence detection is enabled in Settings → General.
- Check that your watched device is on the same Wi-Fi network as the Nomad Eye device.
- Verify the MAC address matches what shows in the scan.

**Status changes too quickly to Away**
- Increase the away timeout. Phones briefly drop off the network during screen lock — a 5-10 minute timeout prevents false Away triggers.
