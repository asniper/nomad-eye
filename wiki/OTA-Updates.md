# OTA Updates

Nomad Eye can update itself from GitHub without requiring SSH access to the device. The update process pulls the latest code, rebuilds the frontend, and restarts the service.

---

## How Updates Work

1. Nomad Eye checks for updates using `git ls-remote` against the GitHub repo
2. If a newer version is available (new tag or new commit, depending on channel), the update is offered
3. On install: `git pull` fetches the new code
4. `npm install && npm run build` rebuilds the frontend if frontend files changed
5. `pip install -r backend/requirements.txt` updates Python deps if requirements changed
6. The systemd service restarts

The device must have internet access to check for and download updates.

---

## Update Channels

| Channel | Source | Description |
|---|---|---|
| `releases` | GitHub tags | Stable releases only. Recommended for most users. |
| `main` | Latest commit on main | Gets fixes and features sooner, but less tested. |

**Settings → Updates → Update Channel**

---

## Manual Check and Install

**Settings → Updates → Check for Updates**

Nomad Eye will query GitHub and display whether an update is available, along with the version/commit and release notes (if any).

Click **Install Update** to proceed. The process takes 1–5 minutes depending on whether the frontend needs to be rebuilt. The UI will show progress and automatically reload when the service restarts.

---

## Auto-Update

When enabled, Nomad Eye checks for and installs updates daily at 3 AM local time.

**Settings → Updates → Auto-Update → Enable**

Auto-update uses the configured update channel. If an update is found, it installs silently and restarts the service. Any active streams or recordings are interrupted briefly during the restart.

A log of auto-update activity is available in **Settings → Updates → Update Log**.

---

## Creating a GitHub Release Tag

If you fork the repo and run your own update server, you need to create release tags for the `releases` channel to work.

```bash
git tag v1.2.3
git push origin v1.2.3
```

Or create a release through the GitHub UI (Releases → Draft a new release). The tag name is used as the version identifier.

---

## Rollback

There is no automated rollback. If an update breaks something:

1. SSH into the device
2. Navigate to the install directory:
   ```bash
   cd /opt/nomad-eye
   ```
3. Find the previous commit:
   ```bash
   git log --oneline -10
   ```
4. Check out the previous version:
   ```bash
   git checkout <commit-hash>
   ```
5. Rebuild the frontend:
   ```bash
   cd frontend && npm install && npm run build
   ```
6. Restart the service:
   ```bash
   sudo systemctl restart nomad-eye-backend
   ```
