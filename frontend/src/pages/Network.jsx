import { useEffect, useState } from 'react'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { network } from '../api/client'

export default function Network() {
  const [netStatus, setNetStatus] = useState(null)
  const [known, setKnown] = useState([])
  const [scanResults, setScanResults] = useState([])
  const [scanning, setScanning] = useState(false)
  const [apActive, setApActive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connectTarget, setConnectTarget] = useState(null)
  const [connectPassword, setConnectPassword] = useState('')
  const [connectStatus, setConnectStatus] = useState(null)
  const [connectLoading, setConnectLoading] = useState(false)

  const reload = () => {
    Promise.all([
      network.status().then(r => {
        setNetStatus(r.data)
        setApActive(r.data.ap_active || false)
      }).catch(() => {}),
      network.known().then(r => setKnown(r.data)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

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

  const connect = async (e) => {
    e.preventDefault()
    setConnectLoading(true)
    setConnectStatus(null)
    try {
      await network.connect(connectTarget, connectPassword)
      setConnectStatus({ ok: true, msg: `Connecting to ${connectTarget}...` })
      setConnectTarget(null)
      setConnectPassword('')
      setTimeout(reload, 3000)
    } catch (err) {
      setConnectStatus({ ok: false, msg: err?.response?.data?.detail || 'Connection failed.' })
    } finally {
      setConnectLoading(false)
    }
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
              <Badge label={netStatus?.connected ? 'Connected' : 'Disconnected'} color={netStatus?.connected ? 'green' : 'red'} />
            </div>
            {netStatus?.ssid && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">SSID</span>
                <span className="text-sm text-white font-medium">{netStatus.ssid}</span>
              </div>
            )}
            {netStatus?.ip && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">IP Address</span>
                <span className="text-sm text-white font-mono">{netStatus.ip}</span>
              </div>
            )}
            {netStatus?.signal != null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Signal</span>
                <span className="text-sm text-white">{netStatus.signal}%</span>
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
              {apActive && (
                <p className="text-xs text-gray-500 mt-2">SSID: NomadEye-Setup</p>
              )}
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
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                </svg>
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
            disabled={scanning}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-md transition-colors"
          >
            {scanning ? 'Scanning...' : 'Scan'}
          </button>
          {scanning && <span className="text-xs text-gray-500">This may take a few seconds...</span>}
        </div>

        {connectStatus && (
          <p className={`text-sm mb-3 ${connectStatus.ok ? 'text-green-400' : 'text-red-400'}`}>
            {connectStatus.msg}
          </p>
        )}

        {connectTarget && (
          <form onSubmit={connect} className="flex items-center gap-2 mb-4 p-3 bg-gray-800 rounded-lg">
            <span className="text-sm text-white font-medium truncate">{connectTarget}</span>
            <input
              type="password"
              value={connectPassword}
              onChange={e => setConnectPassword(e.target.value)}
              placeholder="Password"
              className="flex-1 bg-gray-700 border border-gray-600 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={connectLoading}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {connectLoading ? 'Connecting...' : 'Connect'}
            </button>
            <button
              type="button"
              onClick={() => { setConnectTarget(null); setConnectPassword('') }}
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
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-white">{n.ssid}</p>
                    {n.signal != null && <p className="text-xs text-gray-500">Signal: {n.signal}%</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {netStatus?.ssid === n.ssid && <Badge label="Current" color="green" />}
                  {n.saved && <Badge label="Saved" color="blue" />}
                  {!n.saved && (
                    <button
                      onClick={() => { setConnectTarget(n.ssid); setConnectStatus(null) }}
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
