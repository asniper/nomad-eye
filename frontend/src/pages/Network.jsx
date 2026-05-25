import { useEffect, useRef, useState, useCallback } from 'react'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { network, settings as settingsApi } from '../api/client'

const WIFI_ICON = (
  <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
  </svg>
)

const TAILSCALE_INSTALL_CMD = 'curl -fsSL https://tailscale.com/install.sh | sh'

function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied!' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })}
      className="text-xs px-2 py-0.5 rounded shrink-0 transition-colors"
      style={{ background: '#3A3A3A', color: copied ? '#4ADE80' : '#9CA3AF' }}
    >
      {copied ? copiedLabel : label}
    </button>
  )
}

function TailscaleCard() {
  const [ts, setTs] = useState(null)
  const [settingUrl, setSettingUrl] = useState(false)
  const [urlSet, setUrlSet] = useState(false)
  const [authUrl, setAuthUrl] = useState(null)
  const [fetchingAuth, setFetchingAuth] = useState(false)
  const [authError, setAuthError] = useState(null)
  const pollRef = useRef(null)

  const fetchStatus = useCallback(() =>
    network.tailscale().then(r => setTs(r.data)).catch(() => setTs({ installed: false, connected: false }))
  , [])

  useEffect(() => {
    fetchStatus()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchStatus])

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const r = await network.tailscale().catch(() => null)
      if (r?.data?.connected) {
        clearInterval(pollRef.current); pollRef.current = null
        setTs(r.data); setAuthUrl(null)
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
          <div className="pt-2 border-t border-[#2E2E2E] space-y-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Connect to your Tailscale account</p>
            {!authUrl ? (
              <>
                <p className="text-sm text-gray-400">
                  Tailscale is installed but not connected. Tap below to link this device to your account.
                </p>
                {authError && <p className="text-sm text-red-400">{authError}</p>}
                <button
                  onClick={getAuthUrl}
                  disabled={fetchingAuth}
                  className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
                  style={{ background: '#FFB800', color: '#151925' }}
                >
                  {fetchingAuth ? 'Generating link…' : 'Connect to Tailscale account'}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-400">Visit this link to authorize the device (opens in your browser):</p>
                <div className="flex items-center gap-2 bg-[#1a1a1a] rounded-md px-3 py-2">
                  <a
                    href={authUrl} target="_blank" rel="noreferrer"
                    className="text-sm font-mono flex-1 break-all hover:underline"
                    style={{ color: '#FFB800' }}
                  >{authUrl}</a>
                  <CopyButton text={authUrl} />
                </div>
                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                  <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Waiting for authorization — this page will update automatically.
                </p>
              </>
            )}
          </div>
        </div>

      ) : (
        <div className="space-y-4">
          {/* Status row */}
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
            </>
          )}

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
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Network</span>
                <span className="text-sm text-white font-medium">{netStatus.ssid}</span>
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
              <div key={i} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  {WIFI_ICON}
                  <p className="text-sm font-medium text-white">{n.ssid}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isCurrent
                    ? <Badge label="Current" color="green" />
                    : (
                      <button
                        onClick={() => connectSaved(n.ssid)}
                        disabled={connecting}
                        className="text-xs disabled:opacity-40 transition-colors hover:text-white"
                        style={{ color: '#FFB800' }}
                      >
                        Connect
                      </button>
                    )
                  }
                  <button
                    onClick={async () => {
                      if (!confirm(`Remove "${n.ssid}" from saved networks?`)) return
                      try {
                        await network.deleteKnown(n.ssid)
                        setKnown(k => k.filter(x => x.ssid !== n.ssid))
                      } catch {}
                    }}
                    className="text-xs text-gray-600 hover:text-red-400 transition-colors ml-1"
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
              <button onClick={cancelConnect} className="text-xs text-gray-400 hover:text-white shrink-0">Cancel</button>
            )}
            {!connecting && (
              <button onClick={() => setConnectMsg(null)} className="text-xs text-gray-400 hover:text-white shrink-0">✕</button>
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
              <div key={i} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  {WIFI_ICON}
                  <div>
                    <p className="text-sm font-medium text-white">{n.ssid}</p>
                    {n.signal != null && <p className="text-xs text-gray-500">{n.signal}% signal</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {netStatus?.ssid === n.ssid
                    ? <Badge label="Current" color="green" />
                    : (
                      <button
                        disabled={connecting}
                        onClick={() => {
                          setConnectMsg(null)
                          n.saved ? connectSaved(n.ssid) : setConnectTarget(n.ssid)
                        }}
                        className="text-xs disabled:opacity-40 transition-colors hover:text-white"
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
