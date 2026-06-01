# Remote Access

Nomad Eye supports remote access via [Tailscale](https://tailscale.com), a zero-config VPN. Once connected, you can reach the web UI from anywhere without port forwarding or exposing the device to the public internet.

---

## How It Works

Tailscale creates an encrypted private network (tailnet) between your devices. Your Nomad Eye device gets a stable Tailscale IP address (100.x.x.x) and a MagicDNS hostname (e.g., `nomad-eye.your-tailnet.ts.net`). You access the web UI using that address from any device on your tailnet.

---

## Installing Tailscale on the Device

Nomad Eye includes an in-app Tailscale setup flow.

**Settings → Remote Access → Tailscale**

1. Click **Install Tailscale** — this runs the official Tailscale install script on the device:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   ```
2. Once installed, click **Connect Account**
3. Nomad Eye will display an authentication URL — open it in a browser on any device where you're logged into your Tailscale account
4. Authorize the device in the Tailscale admin console
5. The device will appear as connected in the UI with its Tailscale IP and MagicDNS hostname

---

## Accessing the UI Remotely

After Tailscale is connected:

```
http://<tailscale-ip>:8000
```

or using MagicDNS (if enabled in your Tailscale admin console):

```
http://<hostname>.your-tailnet.ts.net:8000
```

MagicDNS hostnames require your accessing device to also be on the tailnet. Tailscale IP addresses (100.x.x.x) always work regardless of MagicDNS.

---

## Setting the Notification URL

Notification messages include a link back to the detection event. For remote access links to work, set the `notification_url` to your Tailscale IP:

**Settings → Notifications → Notification URL**

```
http://100.x.x.x:8000
```

Links in SMS and email notifications will now point to the Tailscale address, accessible from anywhere on your tailnet.

---

## Sharing with Other Users (Node Sharing)

To give another person access to your Nomad Eye device without adding them to your tailnet:

1. Go to the [Tailscale admin console](https://login.tailscale.com/admin/machines)
2. Find your Nomad Eye device
3. Click **Share** → **Share node**
4. Enter the Tailscale account email of the person you want to share with
5. They accept the share in their Tailscale client — the device appears in their network

Shared users can access `http://<tailscale-ip>:8000` using the web UI login. They still need valid Nomad Eye credentials; Tailscale only provides the network path.

---

## Disconnecting Tailscale

**Settings → Remote Access → Tailscale → Disconnect**

This logs the device out of Tailscale. The device will no longer be reachable via its Tailscale address. Tailscale itself remains installed; you can reconnect at any time.

---

## Captive Portal / AP Mode

If the device has no network connection (e.g., first setup, moved to a new location), Nomad Eye can start a WiFi hotspot (access point) that you connect to directly.

**Settings → WiFi → Start Hotspot**

Connect your phone or laptop to the hotspot SSID, then open `http://192.168.4.1:8000` to access the UI and configure WiFi.
