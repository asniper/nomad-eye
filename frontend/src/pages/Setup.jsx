import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import logoUrl from '../assets/logo-shadow.png'

const api = axios.create({ baseURL: '/api/setup' })

const WIFI_ICON = (
  <svg className="w-5 h-5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
  </svg>
)

const SIGNAL_BARS = (pct) => {
  const color = pct >= 70 ? 'text-green-400' : pct >= 40 ? 'text-yellow-400' : 'text-red-400'
  return <span className={`text-xs font-mono ${color}`}>{pct}%</span>
}

export default function Setup() {
  const [step, setStep] = useState('scan')
  const [networks, setNetworks] = useState([])
  const [scanning, setScanning] = useState(false)
  const [selected, setSelected] = useState(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectedSsid, setConnectedSsid] = useState('')
  const [hostname, setHostname] = useState('nomadeye')
  const [countdown, setCountdown] = useState(15)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)
  const countdownRef = useRef(null)

  const scan = async () => {
    setScanning(true)
    setError(null)
    try {
      const r = await api.get('/scan')
      setNetworks(r.data)
    } catch {
      setError('Scan failed. Make sure the device has WiFi.')
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => { scan() }, [])

  const startPolling = (targetSsid) => {
    let attempts = 0
    let consecutiveErrors = 0

    const succeed = (ssid, host) => {
      clearInterval(pollRef.current)
      setConnectedSsid(ssid)
      setHostname(host || 'nomadeye')
      setStep('connected')
      startCountdown()
    }

    pollRef.current = setInterval(async () => {
      attempts++
      try {
        const r = await api.get('/status')
        consecutiveErrors = 0
        if (r.data.ssid === targetSsid && r.data.connected) {
          succeed(targetSsid, r.data.hostname)
          return
        }
      } catch {
        consecutiveErrors++
        if (consecutiveErrors >= 4) {
          succeed(targetSsid, 'nomadeye')
          return
        }
      }
      if (attempts >= 25) {
        clearInterval(pollRef.current)
        setConnecting(false)
        setStep('scan')
        setError(`Could not connect to "${targetSsid}". Check the password and try again.`)
      }
    }, 2000)
  }

  const startCountdown = () => {
    let t = 15
    setCountdown(t)
    countdownRef.current = setInterval(() => {
      t--
      setCountdown(t)
      if (t <= 0) {
        clearInterval(countdownRef.current)
        finish()
      }
    }, 1000)
  }

  const finish = async () => {
    setStep('done')
    try { await api.post('/finish') } catch {}
  }

  const connect = async (e) => {
    e.preventDefault()
    if (!selected) return
    setConnecting(true)
    setError(null)
    setStep('connecting')
    try {
      await api.post('/connect', { ssid: selected.ssid, password })
      startPolling(selected.ssid)
    } catch {
      setConnecting(false)
      setStep('scan')
      setError('Connection request failed.')
    }
  }

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }, [])

  return (
    <div className="min-h-screen bg-[#1A1A1A] text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Header */}
        <div className="text-center mb-8">
          <img src={logoUrl} alt="Nomad Eye" className="mx-auto mb-3" style={{ width: '230px', maxWidth: '100%' }} />
          <p className="text-gray-400 text-sm">Connect your device to WiFi</p>
        </div>

        {/* Step: Scan / Select */}
        {step === 'scan' && (
          <div className="bg-[#2E2E2E] rounded-2xl p-5 space-y-4 border border-[#3A3A3A]">
            {error && (
              <div className="bg-red-500/10 text-red-400 text-sm px-3 py-2 rounded-lg">{error}</div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-400">
                {networks.length > 0 ? `${networks.length} networks found` : 'No networks found'}
              </p>
              <button
                onClick={scan}
                disabled={scanning}
                className="flex items-center gap-1.5 text-sm disabled:opacity-50 transition-colors"
                style={{ color: '#FFB800' }}
              >
                {scanning
                  ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Scanning…</>
                  : <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh</>
                }
              </button>
            </div>

            <div className="divide-y divide-[#3A3A3A]">
              {networks.map((n, i) => {
                const isSelected = selected?.ssid === n.ssid
                return (
                  <div key={i}>
                    <button
                      onClick={() => { setSelected(isSelected ? null : n); setPassword(''); setError(null) }}
                      className={`w-full flex items-center justify-between py-3 px-1 text-left transition-colors rounded ${
                        isSelected ? 'bg-[#151925]/20' : 'hover:bg-[#3A3A3A]/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {WIFI_ICON}
                        <div>
                          <p className="text-sm font-medium text-white">{n.ssid}</p>
                          {n.security && <p className="text-xs text-gray-500">{n.security}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {n.signal != null && SIGNAL_BARS(n.signal)}
                        {n.saved && <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: '#FFB800', background: 'rgba(255,184,0,0.1)' }}>Saved</span>}
                        <svg className={`w-4 h-4 transition-transform ${isSelected ? 'rotate-180' : 'text-gray-600'}`} style={isSelected ? { color: '#FFB800' } : {}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                        </svg>
                      </div>
                    </button>

                    {isSelected && (
                      <form onSubmit={connect} className="px-1 pb-3 pt-1 space-y-2.5">
                        <div className="relative">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder={n.saved ? 'Leave blank to use saved password' : 'Password'}
                            autoFocus
                            className="w-full bg-[#3A3A3A] border border-[#484848] rounded-lg px-3 py-2.5 text-sm text-white pr-10 focus:outline-none focus:border-[#151925] transition-colors"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {showPassword
                                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21"/>
                                : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></>
                              }
                            </svg>
                          </button>
                        </div>
                        <button
                          type="submit"
                          className="w-full text-white font-medium py-2.5 rounded-lg text-sm hover:opacity-90 transition-opacity"
                          style={{ background: '#FFB800', color: '#151925' }}
                        >
                          Connect
                        </button>
                      </form>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Step: Connecting */}
        {step === 'connecting' && (
          <div className="bg-[#2E2E2E] rounded-2xl p-8 text-center space-y-4 border border-[#3A3A3A]">
            <svg className="w-12 h-12 animate-spin mx-auto" style={{ color: '#FFB800' }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <div>
              <p className="text-lg font-semibold">Connecting to</p>
              <p className="font-mono" style={{ color: '#FFB800' }}>{selected?.ssid}</p>
            </div>
            <p className="text-sm text-gray-500">This may take up to 40 seconds…</p>
          </div>
        )}

        {/* Step: Connected */}
        {step === 'connected' && (
          <div className="bg-[#2E2E2E] rounded-2xl p-6 space-y-5 border border-[#3A3A3A]">
            <div className="text-center">
              <div className="w-14 h-14 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                </svg>
              </div>
              <h2 className="text-xl font-bold text-green-400">Connected!</h2>
              <p className="text-gray-400 text-sm mt-1">Device is now on <span className="text-white font-medium">{connectedSsid}</span></p>
            </div>

            <div className="bg-[#3A3A3A] rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-white">What to do next:</p>
              <ol className="text-sm text-gray-300 space-y-2 list-decimal list-inside">
                <li>Reconnect your device to your normal WiFi network</li>
                <li>Open your browser and go to:</li>
              </ol>
              <div className="bg-[#1A1A1A] rounded-lg px-4 py-3 text-center">
                <p className="font-mono font-semibold text-lg" style={{ color: '#FFB800' }}>http://{hostname}.local:8000</p>
                <p className="text-gray-600 text-xs mt-1">Login: admin / nomadeye</p>
              </div>
            </div>

            <div className="text-center space-y-3">
              <p className="text-xs text-gray-500">
                Hotspot disconnecting in <span className="text-white font-mono">{countdown}s</span>
              </p>
              <button
                onClick={() => { clearInterval(countdownRef.current); finish() }}
                className="w-full text-white font-medium py-2.5 rounded-lg text-sm hover:opacity-90 transition-opacity"
                style={{ background: '#FFB800', color: '#151925' }}
              >
                Done — Disconnect Now
              </button>
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && (
          <div className="bg-[#2E2E2E] rounded-2xl p-8 text-center space-y-4 border border-[#3A3A3A]">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto" style={{ background: 'rgba(0,106,115,0.2)' }}>
              <svg className="w-8 h-8" style={{ color: '#FFB800' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Hotspot Off</h2>
              <p className="text-gray-400 text-sm mt-1">Reconnect to your WiFi, then visit:</p>
              <p className="font-mono font-semibold text-lg mt-3" style={{ color: '#FFB800' }}>http://{hostname}.local:8000</p>
              <p className="text-gray-600 text-xs mt-2">Login: admin / nomadeye</p>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
