import { useEffect, useRef, useState, useCallback } from 'react'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { network, settings as settingsApi } from '../api/client'
import { useConfirm } from '../context/ConfirmContext'

const WIFI_ICON = (
  <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
  </svg>
)

const TAILSCALE_INSTALL_CMD = 'curl -fsSL https://tailscale.com/install.sh | sh'

function SignalBars({ value }) {
  const filled = Math.ceil((value / 100) * 4)
  const color = value >= 70 ? '#4ADE80' : value >= 40 ? '#FFB800' : '#EF4444'
  return (
    <div className="flex items-end gap-0.5" style={{ height: '16px' }}>
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="w-1.5 rounded-sm" style={{ height: `${i * 25}%`, background: i <= filled ? color : '#3A3A3A' }} />
      ))}
    </div>
  )
}

function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied!' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })}
      className="text-xs px-2.5 py-1.5 rounded shrink-0 transition-colors"
      style={{ background: '#3A3A3A', color: copied ? '#4ADE80' : '#9CA3AF' }}
    >
      {copied ? copiedLabel : label}
    </button>
  )
}

function TailscaleCard() {
  const confirm = useConfirm()
  const [ts, setTs] = useState(null)
  const [settingUrl, setSettingUrl] = useState(false)
  const [urlSet, setUrlSet] = useState(false)
  const [authUrl, setAuthUrl] = useState(null)
  const [fetchingAuth, setFetchingAuth] = useState(false)
  const [authError, setAuthError] = useState(null)
  const [authKey, setAuthKey] = useState('')
  const [connectingKey, setConnectingKey] = useState(false)
  const [keyError, setKeyError] = useState(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [enablingHttps, setEnablingHttps] = useState(false)
  const [httpsResult, setHttpsResult] = useState(null)
  const pollRef = useRef(null)

  const fetchStatus = useCallback(() =>
    network.tailscale().then(r => setTs(r.data)).catch(() => setTs({ installed: false, connected: false }))
  , [])

  useEffect(() => {
    fetchStatus()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchStatus])

  const startPolling = (onConnect) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const r = await network.tailscale().catch(() => null)
      if (r?.data?.connected) {
        clearInterval(pollRef.current); pollRef.current = null
        setTs(r.data); setAuthUrl(null)
        if (onConnect) onConnect()
      }
    }, 3000)
  }

  const getAuthUrl = async () => {
    setFetchingAuth(true); setAuthError(null)
    try {
      const r = await network.tailscaleAuthUrl()
      if (r.data.already_connected) { fetchStatus() }
      else { setAuthUrl(r.data.auth_url); startPolling() }
    } catch (e) {
      setAuthError(e?.response?.data?.detail || 'Failed to get auth URL')
    } finally { setFetchingAuth(false) }
  }

  const connectWithKey = async () => {
    if (!authKey.trim()) return
    setConnectingKey(true); setKeyError(null)
    try {
      await network.tailscaleUp(authKey.trim())
      setAuthKey('')
      startPolling(() => setConnectingKey(false))
    } catch (e) {
      setKeyError(e?.response?.data?.detail || 'Failed to connect')
      setConnectingKey(false)
    }
  }

  const disconnect = async () => {
    setDisconnecting(true); setActionError(null)
    try {
      await network.tailscaleDown()
      await fetchStatus()
    } catch (e) {
      setActionError(e?.response?.data?.detail || 'Failed to disconnect')
    } finally { setDisconnecting(false) }
  }

  const enableHttps = async () => {
    setEnablingHttps(true); setHttpsResult(null)
    try {
      await network.tailscaleEnableHttps()
      await fetchStatus()
    } catch (e) {
      setHttpsResult({ ok: false, error: e?.response?.data?.detail || 'Failed to issue certificate' })
    } finally { setEnablingHttps(false) }
  }

  const logout = async () => {
    if (!(await confirm('Log out of Tailscale? You will need to re-authorize this device.'))) return
    setLoggingOut(true); setActionError(null)
    try {
      await network.tailscaleLogout()
      await fetchStatus()
    } catch (e) {
      setActionError(e?.response?.data?.detail || 'Failed to logout')
    } finally { setLoggingOut(false) }
  }

  const accessUrl = ts?.ip ? `http://${ts.ip}` : null
  const viaTs = window.location.hostname.startsWith('100.')

  const setAsRemoteUrl = async () => {
    if (!accessUrl) return
    setSettingUrl(true)
    try {
      await settingsApi.set('external_url', accessUrl)
      setUrlSet(true); setTimeout(() => setUrlSet(false), 3000)
    } catch {}
    setSettingUrl(false)
  }

  const inputCls = "flex-1 min-w-0 bg-[#3A3A3A] border border-[#484848] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none font-mono"

  return (
    <Card title="Tailscale Remote Access">
      {!ts ? (
        <p className="text-sm text-gray-500">Loading…</p>

      ) : !ts.installed ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Tailscale lets you access this device remotely from anywhere — even behind Starlink or mobile hotspots — without port forwarding.
          </p>
          <div className="pt-2 border-t border-[#2E2E2E] space-y-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Install Tailscale on this device</p>
            <p className="text-sm text-gray-400">SSH in and run:</p>
            <div className="flex items-center gap-2 bg-[#1a1a1a] rounded-md px-3 py-2">
              <code className="text-sm text-green-400 font-mono flex-1 break-all">{TAILSCALE_INSTALL_CMD}</code>
              <CopyButton text={TAILSCALE_INSTALL_CMD} />
            </div>
            <p className="text-xs text-gray-500">After install, reload this page and click "Connect to Tailscale account".</p>
          </div>
        </div>

      ) : !ts.connected ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Status</span>
            <Badge label="Not Connected" color="red" />
          </div>

          {/* Browser auth */}
          <div className="pt-2 border-t border-[#2E2E2E] space-y-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Connect via browser</p>
            {!authUrl ? (
              <>
                <p className="text-sm text-gray-400">Generates an authorization link you open in any browser.</p>
                {authError && <p className="text-sm text-red-400">{authError}</p>}
                <button
                  onClick={getAuthUrl}
                  disabled={fetchingAuth || connectingKey}
                  className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
                  style={{ background: '#FFB800', color: '#151925' }}
                >
                  {fetchingAuth ? 'Generating link…' : 'Get authorization link'}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-400">Open this link in your browser to authorize:</p>
                <div className="flex items-center gap-2 bg-[#1a1a1a] rounded-md px-3 py-2">
                  <a href={authUrl} target="_blank" rel="noreferrer"
                    className="text-sm font-mono flex-1 break-all hover:underline" style={{ color: '#FFB800' }}>
                    {authUrl}
                  </a>
                  <CopyButton text={authUrl} />
                </div>
                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                  <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Waiting for authorization — page updates automatically.
                </p>
              </>
            )}
          </div>

          {/* Auth key */}
          <div className="pt-2 border-t border-[#2E2E2E] space-y-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Connect with auth key</p>
            <p className="text-sm text-gray-400">
              Generate a reusable or one-time auth key in the{' '}
              <a href="https://login.tailscale.com/admin/settings/keys" target="_blank" rel="noreferrer"
                className="hover:underline" style={{ color: '#FFB800' }}>Tailscale admin console</a>
              {' '}for headless setup — no browser needed on the device.
            </p>
            {keyError && <p className="text-sm text-red-400">{keyError}</p>}
            <div className="flex gap-2">
              <input
                type="password"
                value={authKey}
                onChange={e => { setAuthKey(e.target.value); setKeyError(null) }}
                placeholder="tskey-auth-…"
                className={inputCls}
                onFocus={e => e.target.style.borderColor = '#4c6e5d'}
                onBlur={e => e.target.style.borderColor = '#484848'}
                onKeyDown={e => e.key === 'Enter' && connectWithKey()}
              />
              <button
                onClick={connectWithKey}
                disabled={!authKey.trim() || connectingKey || fetchingAuth}
                className="px-4 py-1.5 rounded-md text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity shrink-0"
                style={{ background: '#FFB800', color: '#151925' }}
              >
                {connectingKey ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </div>
        </div>

      ) : (
        <div className="space-y-4">
          {/* Status + controls */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Status</span>
            <div className="flex items-center gap-2">
              {viaTs && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#1e3a2f', color: '#4ADE80' }}>
                  Viewing via Tailscale
                </span>
              )}
              <Badge label="Connected" color="green" />
            </div>
          </div>

          {ts.ip && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Tailscale IP</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-mono">{ts.ip}</span>
                  <CopyButton text={ts.ip} />
                </div>
              </div>
              {ts.dns_name && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">MagicDNS hostname</span>
                  <span className="text-sm text-white font-mono">{ts.dns_name}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Access URL</span>
                <a href={accessUrl} target="_blank" rel="noreferrer"
                  className="text-sm font-mono hover:underline" style={{ color: '#FFB800' }}>
                  {accessUrl}
                </a>
              </div>
              <button
                onClick={setAsRemoteUrl}
                disabled={settingUrl}
                className="text-xs px-3 py-1.5 rounded-md disabled:opacity-40 hover:opacity-80 transition-opacity"
                style={{ background: '#2a3a2a', color: urlSet ? '#4ADE80' : '#9CA3AF', border: '1px solid #3a4a3a' }}
              >
                {urlSet ? '✓ Set as notification URL' : settingUrl ? 'Saving…' : 'Use as notification URL'}
              </button>

              {ts.dns_name && (
                <div className="pt-2 border-t border-[#2E2E2E] space-y-1.5">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">HTTPS</p>
                  {ts.tailscale_https ? (
                    <p className="text-xs text-green-400">
                      ✓ Trusted certificate active for <span className="font-mono">https://{ts.https_hostname || ts.dns_name}</span>
                      {ts.https_expires && <span className="text-gray-500"> — expires {ts.https_expires}</span>}
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-gray-500">
                        The device currently uses a self-signed certificate for local access (one-time browser warning).
                        This issues a real, trusted certificate for <span className="font-mono">{ts.dns_name}</span> via Tailscale
                        — requires HTTPS Certificates enabled on your tailnet in the Tailscale admin console.
                      </p>
                      <button
                        onClick={enableHttps}
                        disabled={enablingHttps}
                        className="text-xs px-3 py-1.5 rounded-md disabled:opacity-40 hover:opacity-80 transition-opacity"
                        style={{ background: '#2a3a2a', color: '#9CA3AF', border: '1px solid #3a4a3a' }}
                      >
                        {enablingHttps ? 'Issuing certificate…' : 'Enable HTTPS via Tailscale'}
                      </button>
                    </>
                  )}
                  {httpsResult && !httpsResult.ok && (
                    <p className="text-xs text-red-400">{httpsResult.error}</p>
                  )}
                </div>
              )}
            </>
          )}

          {/* Disconnect / Logout */}
          <div className="pt-2 border-t border-[#2E2E2E] space-y-2">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Connection controls</p>
            {actionError && <p className="text-sm text-red-400">{actionError}</p>}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={disconnect}
                disabled={disconnecting || loggingOut}
                className="px-3 py-1.5 rounded-md text-sm disabled:opacity-50 hover:opacity-80 transition-opacity"
                style={{ background: '#3A3A3A', color: '#9CA3AF' }}
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
              <button
                onClick={logout}
                disabled={disconnecting || loggingOut}
                className="px-3 py-1.5 rounded-md text-sm disabled:opacity-50 hover:opacity-80 transition-opacity"
                style={{ background: 'rgba(239,68,68,0.1)', color: '#F87171' }}
              >
                {loggingOut ? 'Logging out…' : 'Logout'}
              </button>
            </div>
            <p className="text-xs text-gray-600">Disconnect keeps your account linked. Logout removes this device from your Tailscale account.</p>
          </div>

          {/* Access from other devices */}
          <div className="pt-2 border-t border-[#2E2E2E] space-y-2">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Access from your other devices</p>
            <ol className="space-y-1.5 text-sm text-gray-400 list-decimal list-inside">
              <li>
                Download the Tailscale app —{' '}
                <a href="https://tailscale.com/download" target="_blank" rel="noreferrer" className="hover:underline" style={{ color: '#FFB800' }}>
                  tailscale.com/download
                </a>
              </li>
              <li>Sign in with the <strong className="text-gray-300 font-medium">same account</strong> used to authorize this device</li>
              <li>
                Open{' '}
                <a href={accessUrl ?? '#'} target="_blank" rel="noreferrer" className="font-mono hover:underline" style={{ color: '#FFB800' }}>
                  {accessUrl ?? 'http://100.x.x.x'}
                </a>{' '}
                — works on any network including Starlink and hotspots
              </li>
            </ol>
          </div>

          {/* Node sharing */}
          <div className="pt-2 border-t border-[#2E2E2E] space-y-2">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Share with other people</p>
            <p className="text-sm text-gray-400">
              Share this device with someone without giving them your Tailscale login. They use their own account.
            </p>
            <ol className="space-y-1.5 text-sm text-gray-400 list-decimal list-inside">
              <li>
                Open the{' '}
                <a href="https://login.tailscale.com/admin/machines" target="_blank" rel="noreferrer" className="hover:underline" style={{ color: '#FFB800' }}>
                  Tailscale admin console
                </a>
              </li>
              <li>
                Find <span className="font-mono text-white">{ts.hostname || 'nomadeye'}</span> and click the <span className="text-white font-medium">⋯</span> menu → <span className="text-white font-medium">Share…</span>
              </li>
              <li>Enter their Tailscale email address and send the invite</li>
              <li>They accept in their Tailscale app and can then access the device at the same IP</li>
            </ol>
            <p className="text-xs text-gray-500">Node sharing is free on all Tailscale plans.</p>
          </div>
        </div>
      )}
    </Card>
  )
}

function ExternalAccessCard() {
  const [url, setUrl] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    settingsApi.getAll().then(r => setUrl(r.data?.external_url ?? '')).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await settingsApi.set('external_url', url)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {}
    setSaving(false)
  }

  const inputCls = "bg-[#3A3A3A] border border-[#484848] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none transition-colors flex-1 min-w-0"

  return (
    <Card title="Remote Access">
      <p className="text-sm text-gray-400 mb-4">
        Optional external URL for accessing Nomad Eye outside your local network — via a VPN, reverse proxy, or port forward. Used as the link destination in notifications.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="url"
          value={url}
          onChange={e => { setUrl(e.target.value); setSaved(false) }}
          placeholder="https://nomadeye.example.com"
          className={inputCls}
          onFocus={e => e.target.style.borderColor = '#4c6e5d'}
          onBlur={e => e.target.style.borderColor = '#484848'}
        />
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 disabled:opacity-40 text-sm rounded-md transition-opacity hover:opacity-90 shrink-0"
          style={{ background: '#FFB800', color: '#151925' }}
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      {url && (
        <p className="text-xs text-gray-500 mt-2">
          Notifications will link to <span className="font-mono text-gray-300">{url}</span>
        </p>
      )}
    </Card>
  )
}

export default function Network() {
  const confirm = useConfirm()
  const [netStatus, setNetStatus] = useState(null)
  const [known, setKnown] = useState([])
  const [scanResults, setScanResults] = useState([])
  const [scanning, setScanning] = useState(false)
  const [apActive, setApActive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connectTarget, setConnectTarget] = useState(null)
  const [connectPassword, setConnectPassword] = useState('')
  const [connectMsg, setConnectMsg] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [apToggling, setApToggling] = useState(false)
  const pollRef = useRef(null)

  const fetchStatus = useCallback(() =>
    network.status().then(r => {
      setNetStatus(r.data)
      setApActive(r.data.ap_active || false)
      return r.data
    }).catch(() => null), [])

  const reload = useCallback(() => {
    Promise.all([
      fetchStatus(),
      network.known().then(r => setKnown(r.data)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [fetchStatus])

  useEffect(() => { reload() }, [reload])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const scan = async () => {
    setScanning(true)
    setScanResults([])
    try {
      const r = await network.scan()
      setScanResults(r.data)
    } catch {
      setScanResults([])
    } finally {
      setScanning(false)
    }
  }

  const startPolling = (targetSsid) => {
    if (pollRef.current) clearInterval(pollRef.current)
    let attempts = 0
    pollRef.current = setInterval(async () => {
      attempts++
      const status = await fetchStatus()
      if (status?.ssid === targetSsid) {
        clearInterval(pollRef.current); pollRef.current = null
        setConnecting(false)
        setConnectMsg({ ok: true, text: `Connected to ${targetSsid}` })
        reload()
        return
      }
      if (attempts >= 20) {
        clearInterval(pollRef.current); pollRef.current = null
        setConnecting(false)
        setConnectMsg({ ok: false, text: `Could not connect to ${targetSsid}. Check the password and try again.` })
      }
    }, 2000)
  }

  const connect = async (e) => {
    e.preventDefault()
    const target = connectTarget
    setConnecting(true)
    setConnectMsg({ ok: null, text: `Connecting to ${target}…` })
    setConnectTarget(null)
    setConnectPassword('')
    try {
      await network.connect(target, connectPassword)
      startPolling(target)
    } catch {
      setConnecting(false)
      setConnectMsg({ ok: false, text: 'Connection request failed.' })
    }
  }

  const connectSaved = async (ssid) => {
    if (connecting) return
    setConnecting(true)
    setConnectMsg({ ok: null, text: `Connecting to ${ssid}…` })
    try {
      await network.connectSaved(ssid)
      startPolling(ssid)
    } catch {
      setConnecting(false)
      setConnectMsg({ ok: false, text: 'Connection request failed.' })
    }
  }

  const cancelConnect = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setConnecting(false); setConnectMsg(null); setConnectTarget(null); setConnectPassword('')
  }

  const toggleAp = async () => {
    const wasActive = apActive
    setApToggling(true)
    try {
      const r = wasActive ? await network.apStop() : await network.apStart()
      setApActive(r.data.active)
    } catch (err) {
      if (!wasActive && !err.response) {
        setApActive(true)
      } else {
        alert(err?.response?.data?.detail || 'Failed to toggle hotspot.')
        await fetchStatus().then(s => s && setApActive(s.ap_active || false))
      }
    } finally {
      setApToggling(false)
    }
  }

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Current Status">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Connection</span>
              <Badge label={netStatus?.connected ? 'Connected' : 'Disconnected'} color={netStatus?.connected ? 'green' : 'red'} />
            </div>
            {netStatus?.hostname && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Device name</span>
                <span className="text-sm text-white font-mono">{netStatus.hostname}.local</span>
              </div>
            )}
            {netStatus?.ssid && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-400 shrink-0">Network</span>
                <span className="text-sm text-white font-medium truncate min-w-0">{netStatus.ssid}</span>
              </div>
            )}
            {netStatus?.signal != null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Signal</span>
                <div className="flex items-center gap-2">
                  <SignalBars value={netStatus.signal} />
                  <span className="text-sm text-white">{netStatus.signal}%</span>
                </div>
              </div>
            )}
            {netStatus?.ip && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">IP Address</span>
                <span className="text-sm text-white font-mono">{netStatus.ip}</span>
              </div>
            )}
          </div>
        </Card>

        <Card title="Hotspot (AP Mode)">
          <p className="text-sm text-gray-400 mb-3">Broadcast a WiFi hotspot so you can connect directly to the device.</p>
          <div className="flex items-center justify-between">
            <div>
              <Badge label={apActive ? 'Active' : 'Inactive'} color={apActive ? 'green' : 'gray'} />
              {apActive && <p className="text-xs text-gray-500 mt-2">SSID: NomadEye-Setup</p>}
            </div>
            <button
              onClick={toggleAp}
              disabled={apToggling}
              className="px-4 py-1.5 rounded-md text-sm font-medium text-white disabled:opacity-50 hover:opacity-80 transition-opacity"
              style={{ background: apActive ? '#dc2626' : '#FFB800', color: '#ffffff' }}
            >
              {apToggling ? '…' : apActive ? 'Stop Hotspot' : 'Start Hotspot'}
            </button>
          </div>
        </Card>
      </div>

      <Card title="Known Networks">
        {known.length === 0 && <p className="text-gray-500 text-sm">No saved networks.</p>}
        <div className="divide-y divide-[#3A3A3A]">
          {known.map((n, i) => {
            const isCurrent = netStatus?.ssid === n.ssid
            return (
              <div key={i} className="flex items-center justify-between gap-2 py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  {WIFI_ICON}
                  <p className="text-sm font-medium text-white truncate">{n.ssid}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {isCurrent
                    ? <Badge label="Current" color="green" />
                    : (
                      <button
                        onClick={() => connectSaved(n.ssid)}
                        disabled={connecting}
                        className="text-xs disabled:opacity-40 transition-colors hover:text-white px-2 py-1"
                        style={{ color: '#FFB800' }}
                      >
                        Connect
                      </button>
                    )
                  }
                  <button
                    onClick={async () => {
                      if (!(await confirm(`Remove "${n.ssid}" from saved networks?`))) return
                      try {
                        await network.deleteKnown(n.ssid)
                        setKnown(k => k.filter(x => x.ssid !== n.ssid))
                      } catch {}
                    }}
                    className="text-xs text-gray-600 hover:text-red-400 transition-colors px-2 py-1"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card title="Scan for Networks">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={scan}
            disabled={scanning || connecting}
            className="px-4 py-1.5 disabled:opacity-50 text-white text-sm rounded-md hover:opacity-90 transition-opacity"
            style={{ background: '#FFB800', color: '#151925' }}
          >
            {scanning ? 'Scanning...' : 'Scan'}
          </button>
          {scanning && <span className="text-xs text-gray-500">This may take a few seconds…</span>}
        </div>

        {connectMsg && (
          <div className={`flex items-center justify-between gap-3 mb-4 px-3 py-2 rounded-lg text-sm ${
            connectMsg.ok === true ? 'bg-green-500/10 text-green-400' :
            connectMsg.ok === false ? 'bg-red-500/10 text-red-400' :
            'bg-[#151925]/10 text-[#FFB800]'
          }`}>
            <span className="flex items-center gap-2">
              {connectMsg.ok === null && (
                <svg className="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              )}
              {connectMsg.text}
            </span>
            {connecting && (
              <button onClick={cancelConnect} className="text-xs text-gray-400 hover:text-white shrink-0 px-2 py-1">Cancel</button>
            )}
            {!connecting && (
              <button onClick={() => setConnectMsg(null)} className="text-xs text-gray-400 hover:text-white shrink-0 px-2 py-1">✕</button>
            )}
          </div>
        )}

        {connectTarget && !connecting && (
          <form onSubmit={connect} className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-[#3A3A3A] rounded-lg">
            <span className="text-sm text-white font-medium">{connectTarget}</span>
            <input
              type="password"
              value={connectPassword}
              onChange={e => setConnectPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              className="flex-1 min-w-32 bg-[#2E2E2E] border border-[#484848] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none transition-colors"
              onFocus={e => e.target.style.borderColor = '#151925'}
              onBlur={e => e.target.style.borderColor = '#484848'}
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-white text-sm rounded-md hover:opacity-90 transition-opacity whitespace-nowrap"
              style={{ background: '#FFB800', color: '#151925' }}
            >
              Connect
            </button>
            <button
              type="button"
              onClick={cancelConnect}
              className="px-3 py-1.5 bg-[#484848] hover:bg-[#3A3A3A] text-white text-sm rounded-md transition-colors"
            >
              Cancel
            </button>
          </form>
        )}

        {scanResults.length > 0 && (
          <div className="divide-y divide-[#3A3A3A]">
            {scanResults.map((n, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  {WIFI_ICON}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{n.ssid}</p>
                    {n.signal != null && <p className="text-xs text-gray-500">{n.signal}% signal</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {netStatus?.ssid === n.ssid
                    ? <Badge label="Current" color="green" />
                    : (
                      <button
                        disabled={connecting}
                        onClick={() => {
                          setConnectMsg(null)
                          n.saved ? connectSaved(n.ssid) : setConnectTarget(n.ssid)
                        }}
                        className="text-xs disabled:opacity-40 transition-colors hover:text-white px-2 py-1"
                        style={{ color: '#FFB800' }}
                      >
                        {n.saved ? 'Switch' : 'Connect'}
                      </button>
                    )
                  }
                </div>
              </div>
            ))}
          </div>
        )}

        {!scanning && scanResults.length === 0 && (
          <p className="text-gray-600 text-sm">Press Scan to find available networks.</p>
        )}
      </Card>

      <TailscaleCard />
      <ExternalAccessCard />
    </div>
  )
}
