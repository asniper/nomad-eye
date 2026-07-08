# Remote Access

Nomad Eye supports remote access via [Tailscale](https://tailscale.com), a zero-config VPN. Once connected, you can reach the web UI from anywhere without port forwarding or exposing the device to the public internet.

---

## How It Works

Tailscale creates an encrypted private network (tailnet) between your devices. Your Nomad Eye device gets a stable Tailscale IP address (100.x.x.x) and a MagicDNS hostname (e.g., `nomad-eye.your-tailnet.ts.net`). You access the web UI using that address from any device on your tailnet.

---

## Installing Tailscale on the Device

Nomad Eye includes an in-app Tailscale setup flow for connecting/disconnecting, but not for installing the Tailscale binary itself.

**Settings → Network → Tailscale Remote Access**

1. If Tailscale isn't installed yet, the card shows the official install command with a copy button — you still need to run it yourself over SSH:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   ```
   Reload the page once it finishes.
2. Once installed, click **Connect Account** — Nomad Eye will display an authentication URL. Open it in a browser on any device where you're logged into your Tailscale account.

   Alternatively, if you have a reusable auth key from the [Tailscale admin console](https://login.tailscale.com/admin/settings/keys), enter it in the **Auth Key** field and click **Connect with Key** to authenticate without going through the browser flow.

3. Authorize the device in the Tailscale admin console
4. The device will appear as connected in the UI with its Tailscale IP and MagicDNS hostname

On successful connect, Nomad Eye automatically grants the `nomadeye` service user operator permissions (`tailscale set --operator=nomadeye`). This allows in-app disconnect and logout to work without requiring root access.

---

## Accessing the UI Remotely

After Tailscale is connected:

```
http://<tailscale-ip>
```

or using MagicDNS (if enabled in your Tailscale admin console):

```
http://<hostname>.your-tailnet.ts.net
```

MagicDNS hostnames require your accessing device to also be on the tailnet. Tailscale IP addresses (100.x.x.x) always work regardless of MagicDNS.

---

## Setting the Notification Link

Notification messages (ntfy, SMS, and email alike) include a link back to the detection event. For remote access links to work from anywhere, point that link at your Tailscale address:

**Settings → General → Notification Links**

Set the link mode to **Tailscale IP** — Nomad Eye auto-detects the device's current Tailscale address (via `tailscale ip -4`) each time a notification is sent, so there's nothing to type in manually. The other modes are **Local IP** (LAN-only) and **Device Name** (a hostname you set yourself).

---

## Sharing with Other Users (Node Sharing)

To give another person access to your Nomad Eye device without adding them to your tailnet:

1. Go to the [Tailscale admin console](https://login.tailscale.com/admin/machines)
2. Find your Nomad Eye device
3. Click **Share** → **Share node**
4. Enter the Tailscale account email of the person you want to share with
5. They accept the share in their Tailscale client — the device appears in their network

Shared users can access `http://<tailscale-ip>` using the web UI login. They still need valid Nomad Eye credentials; Tailscale only provides the network path.

---

## Disconnecting and Logging Out

**Settings → Network → Tailscale Remote Access → Disconnect** — takes the device offline (equivalent to `tailscale down`) but keeps it authenticated. Reconnect any time without re-authenticating.

**Settings → Network → Tailscale Remote Access → Logout** — fully removes the device from your tailnet. You'll need to re-authenticate via the browser flow or an auth key to reconnect.

Both operations run as the `nomadeye` user without root because Nomad Eye sets the Tailscale operator on connect.

---

## Captive Portal / AP Mode

If the device has no network connection (e.g., first setup, moved to a new location), Nomad Eye can start a WiFi hotspot (access point) that you connect to directly.

**Settings → Network → Hotspot (AP Mode) → Start Hotspot**

Connect your phone or laptop to the hotspot SSID, then open `http://10.42.0.1` to access the UI and configure WiFi.
