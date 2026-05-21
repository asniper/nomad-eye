import { useEffect, useRef, useState, useCallback } from 'react'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { network } from '../api/client'

const WIFI_ICON = (
  <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
  </svg>
)

export default function Network() {
  const [netStatus, setNetStatus] = useState(null)
  const [known, setKnown] = useState([])
  const [scanResults, setScanResults] = useState([])
  const [scanning, setScanning] = useState(false)
  const [apActive, setApActive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connectTarget, setConnectTarget] = useState(null)
  const [connectPassword, setConnectPassword] = useState('')
  const [connectMsg, setConnectMsg] = useState(null)  // { ok, text }
  const [connecting, setConnecting] = useState(false)
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

  // Stop polling when component unmounts
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
    const maxAttempts = 20 // 40 seconds total

    pollRef.current = setInterval(async () => {
      attempts++
      const status = await fetchStatus()

      if (status?.ssid === targetSsid) {
        clearInterval(pollRef.current)
        pollRef.current = null
        setConnecting(false)
        setConnectMsg({ ok: true, text: `Connected to ${targetSsid}` })
        reload()
        return
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollRef.current)
        pollRef.current = null
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

  const cancelConnect = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setConnecting(false)
    setConnectMsg(null)
    setConnectTarget(null)
    setConnectPassword('')
  }

  const toggleAp = async () => {
    try {
      if (apActive) await network.apStop()
      else await network.apStart()
      setApActive(a => !a)
    } catch {}
  }

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Network</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Current Status">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Connection</span>
              <Badge label={netStatus?.connected ? 'Connected' : 'Disconnected'}
                color={netStatus?.connected ? 'green' : 'red'} />
            </div>
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
          <p className="text-sm text-gray-400 mb-3">
            Broadcast a WiFi hotspot so you can connect directly to the device.
          </p>
          <div className="flex items-center justify-between">
            <div>
              <Badge label={apActive ? 'Active' : 'Inactive'} color={apActive ? 'green' : 'gray'} />
              {apActive && <p className="text-xs text-gray-500 mt-2">SSID: NomadEye-Setup</p>}
            </div>
            <button
              onClick={toggleAp}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                apActive ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              {apActive ? 'Stop Hotspot' : 'Start Hotspot'}
            </button>
          </div>
        </Card>
      </div>

      <Card title="Known Networks">
        {known.length === 0 && <p className="text-gray-500 text-sm">No saved networks.</p>}
        <div className="divide-y divide-gray-800">
          {known.map((n, i) => (
            <div key={i} className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-3">
                {WIFI_ICON}
                <div>
                  <p className="text-sm font-medium text-white">{n.ssid}</p>
                  {n.last_connected && (
                    <p className="text-xs text-gray-500">Last: {new Date(n.last_connected).toLocaleDateString()}</p>
                  )}
                </div>
              </div>
              {netStatus?.ssid === n.ssid && <Badge label="Current" color="green" />}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Scan for Networks">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={scan}
            disabled={scanning || connecting}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-md transition-colors"
          >
            {scanning ? 'Scanning...' : 'Scan'}
          </button>
          {scanning && <span className="text-xs text-gray-500">This may take a few seconds…</span>}
        </div>

        {/* Connection status banner */}
        {connectMsg && (
          <div className={`flex items-center justify-between gap-3 mb-4 px-3 py-2 rounded-lg text-sm ${
            connectMsg.ok === true ? 'bg-green-500/10 text-green-400' :
            connectMsg.ok === false ? 'bg-red-500/10 text-red-400' :
            'bg-blue-500/10 text-blue-300'
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
              <button onClick={cancelConnect} className="text-xs text-gray-400 hover:text-white shrink-0">
                Cancel
              </button>
            )}
            {!connecting && (
              <button onClick={() => setConnectMsg(null)} className="text-xs text-gray-400 hover:text-white shrink-0">
                ✕
              </button>
            )}
          </div>
        )}

        {/* Password form for selected network */}
        {connectTarget && !connecting && (
          <form onSubmit={connect} className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-gray-800 rounded-lg">
            <span className="text-sm text-white font-medium">{connectTarget}</span>
            <input
              type="password"
              value={connectPassword}
              onChange={e => setConnectPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              className="flex-1 min-w-32 bg-gray-700 border border-gray-600 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors whitespace-nowrap"
            >
              Connect
            </button>
            <button
              type="button"
              onClick={cancelConnect}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-md transition-colors"
            >
              Cancel
            </button>
          </form>
        )}

        {scanResults.length > 0 && (
          <div className="divide-y divide-gray-800">
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
                  {netStatus?.ssid === n.ssid && <Badge label="Current" color="green" />}
                  {n.saved && netStatus?.ssid !== n.ssid && <Badge label="Saved" color="blue" />}
                  {!n.saved && !connecting && (
                    <button
                      onClick={() => { setConnectTarget(n.ssid); setConnectMsg(null) }}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!scanning && scanResults.length === 0 && (
          <p className="text-gray-600 text-sm">Press Scan to find available networks.</p>
        )}
      </Card>
    </div>
  )
}
