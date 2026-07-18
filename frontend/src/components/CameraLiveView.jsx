import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import { cameras } from '../api/client'

export const OVERLAY_CATEGORIES = ['people', 'vehicles', 'animals', 'faces', 'other']
export const CATEGORY_STYLE = {
  people:   { on: { background: '#F87171', color: '#1a0000' }, off: { background: '#3A3A3A', color: '#F87171' } },
  vehicles: { on: { background: '#60A5FA', color: '#00001a' }, off: { background: '#3A3A3A', color: '#60A5FA' } },
  animals:  { on: { background: '#4ADE80', color: '#001a00' }, off: { background: '#3A3A3A', color: '#4ADE80' } },
  faces:    { on: { background: '#A855F7', color: '#ffffff' }, off: { background: '#3A3A3A', color: '#A855F7' } },
  other:    { on: { background: '#FCD34D', color: '#1a1500' }, off: { background: '#3A3A3A', color: '#FCD34D' } },
}

// Shared derivation for the Live/Offline/Reloading badge both callers render
// in their own header — status comes from onStatusChange below.
export function statusBadge({ connected, reloading }) {
  return {
    label: reloading ? 'Reloading' : connected ? 'Live' : 'Offline',
    color: reloading ? 'yellow' : connected ? 'green' : 'red',
  }
}

const STATE_STYLE = {
  idle:     { label: 'Idle',         bg: '#2A2A2A', color: '#6B7280' },
  motion:   { label: 'Motion',       bg: '#78350f', color: '#FCD34D' },
  cooldown: { label: 'Cooldown',     bg: '#1e3a5f', color: '#93C5FD' },
  stuck:    { label: 'Stuck!',       bg: '#7f1d1d', color: '#FCA5A5' },
  timeout:  { label: 'AI Timeout',   bg: '#581c87', color: '#D8B4FE' },
}

const MODEL_NAMES = {
  'yolov8n':        'YOLOv8 Nano',
  'yolov8s':        'YOLOv8 Small',
  'yolov8m':        'YOLOv8 Medium',
  'yolov8s-worldv2':'YOLOWorld',
  'megadetector':   'MegaDetector',
  'owlv2':          'OWLv2',
  'grounding-dino': 'Grounding DINO',
}

function Row({ label, value }) {
  return (
    <>
      <span className="text-gray-600">{label}</span>
      <span className="text-gray-300">{value}</span>
    </>
  )
}

function DebugPanel({ info }) {
  if (!info || Object.keys(info).length === 0) {
    return (
      <div className="rounded-lg bg-[#1A1A1A] border border-[#3A3A3A] px-3 py-2 text-xs text-gray-600 font-mono">
        Waiting for AI debug data…
      </div>
    )
  }
  const s = STATE_STYLE[info.state] || STATE_STYLE.idle
  const modelName = MODEL_NAMES[info.model_key] || info.model_key || 'AI'
  return (
    <div className="rounded-lg bg-[#1A1A1A] border border-[#3A3A3A] px-3 py-2.5 font-mono text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-gray-500 uppercase tracking-wider text-[10px]">AI Debug</span>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-[10px]">{modelName}</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: s.bg, color: s.color }}>
            {s.label}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <Row label="Motion" value={info.has_motion
          ? `Yes · ${info.motion_secs}s${info.stuck_secs ? ` (reset at ${info.stuck_secs}s)` : ''}`
          : 'No'} />
        <Row label="Cooldown left" value={info.cooldown_remaining > 0 ? `${info.cooldown_remaining}s` : '—'} />
        <Row label={`${modelName} latency`} value={info.last_yolo_ms != null ? `${info.last_yolo_ms} ms` : '—'} />
        <Row label={`${modelName} last ran`} value={info.last_yolo_secs_ago != null ? `${info.last_yolo_secs_ago}s ago` : 'never'} />
        <Row label="Active detections" value={info.active_detections ?? 0} />
        <Row label="Auto-resets" value={info.auto_resets ?? 0} />
        {(info.yolo_timeouts ?? 0) > 0 && (
          <Row label={`${modelName} timeouts`} value={<span style={{ color: '#D8B4FE' }}>{info.yolo_timeouts}</span>} />
        )}
      </div>
    </div>
  )
}

// Shared live-view mechanics — used by both the Cameras list card and the
// per-camera detail page, so fixes like the 1008-close-code handling below
// only need to happen once. `children` renders into the same button row as
// the controls below (e.g. navigation links to other panels), so callers can
// extend the row without this component knowing about them.
const CameraLiveView = forwardRef(function CameraLiveView(
  { cam, onEnabledChange, onStatusChange, playback, onGoLive, onPlaybackEnded, onPlaybackError, children }, ref
) {
  const imgRef = useRef(null)
  const wsRef = useRef(null)
  const lastFrameUrlRef = useRef(null)
  const playbackVideoRef = useRef(null)

  // Exposed so a caller (e.g. "go to this date/time") can seek the playback
  // video directly — setting .currentTime before metadata loads is queued by
  // the browser and honored once it can seek, so this works whether the
  // target segment is already loaded or was just selected.
  useImperativeHandle(ref, () => ({
    seekTo: (seconds) => {
      if (playbackVideoRef.current) playbackVideoRef.current.currentTime = seconds
    },
  }), [])
  const [overlay, setOverlay] = useState(true)
  const [hiddenCategories, setHiddenCategories] = useState(() => {
    try {
      const saved = localStorage.getItem(`nomadeye_hidden_cats_${cam.id}`)
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })
  const [connected, setConnected] = useState(false)
  const [fps, setFps] = useState(0)
  const fpsCountRef = useRef(0)
  const [wsKey, setWsKey] = useState(0)
  const intentionalClose = useRef(false)

  const [reloading, setReloading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState(false)
  const [nightMode, setNightMode] = useState(cam.night_mode || 'off')
  const [nightModeHw, setNightModeHw] = useState(cam.night_mode_hw || false)
  const [debugMode, setDebugMode] = useState(false)
  const [debugInfo, setDebugInfo] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [togglingEnabled, setTogglingEnabled] = useState(false)
  const videoContainerRef = useRef(null)

  const alive = !!cam.alive

  // Header badge (Live/Offline/Reloading + fps) is caller-side layout, but the state
  // driving it — the WS connection this component owns, not just the `alive` prop —
  // isn't, so report it up rather than duplicating the WS logic in every caller.
  useEffect(() => {
    onStatusChange?.({ connected, reloading, fps })
  }, [connected, reloading, fps]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendFilter = useCallback((hidden) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ hidden_categories: [...hidden] }))
    }
  }, [])

  const toggleDebug = useCallback(() => {
    setDebugMode(prev => {
      const next = !prev
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ debug: next }))
      }
      if (!next) setDebugInfo(null)
      return next
    })
  }, [])

  const toggleCategory = useCallback((cat) => {
    setHiddenCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      sendFilter(next)
      try { localStorage.setItem(`nomadeye_hidden_cats_${cam.id}`, JSON.stringify([...next])) } catch {}
      return next
    })
  }, [sendFilter, cam.id])

  const inPlayback = !!playback

  useEffect(() => {
    // Don't hold a live WS open (bandwidth/battery, especially on mobile) while
    // the caller is showing a recorded clip instead of this component's own feed.
    if (!alive || inPlayback) { setConnected(false); return }
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    // Browsers can't set an Authorization header on a WebSocket handshake, so the
    // session token travels as a query param instead — see cameras.py's stream() route.
    const token = localStorage.getItem('nomadeye_auth') || ''
    const ws = new WebSocket(`${proto}://${window.location.host}/api/cameras/${cam.id}/stream?token=${encodeURIComponent(token)}`)
    wsRef.current = ws
    ws.binaryType = 'blob'
    ws.onopen = () => {
      setConnected(true)
      sendFilter(hiddenCategories)
      if (debugMode) ws.send(JSON.stringify({ debug: true }))
    }
    ws.onclose = (event) => {
      setConnected(false)
      // 1008 = the backend rejected/expired our session token (cameras.py's stream()
      // route). Retrying with the same stale token would just loop forever every 3s —
      // treat it like an HTTP 401 and force back to the login screen instead.
      if (event.code === 1008) {
        localStorage.removeItem('nomadeye_auth')
        localStorage.removeItem('nomadeye_user')
        window.location.href = '/'
      } else if (!intentionalClose.current) {
        setTimeout(() => setWsKey(k => k + 1), 3000)
      }
      intentionalClose.current = false
    }
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        try { setDebugInfo(JSON.parse(e.data)) } catch {}
        return
      }
      const url = URL.createObjectURL(e.data)
      if (imgRef.current) {
        const old = imgRef.current.src
        imgRef.current.src = url
        if (old.startsWith('blob:')) URL.revokeObjectURL(old)
      }
      lastFrameUrlRef.current = url
      fpsCountRef.current++
    }
    const fpsTimer = setInterval(() => { setFps(fpsCountRef.current); fpsCountRef.current = 0 }, 1000)
    return () => {
      intentionalClose.current = true
      ws.close()
      clearInterval(fpsTimer)
      // The <img> unmounts (playback/offline) or gets a new src (reconnect)
      // without ever revoking its own blob — this is the one place that
      // reliably still has the reference once the DOM node might be gone.
      if (lastFrameUrlRef.current) { URL.revokeObjectURL(lastFrameUrlRef.current); lastFrameUrlRef.current = null }
    }
  }, [cam.id, wsKey, alive, inPlayback]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOverlayToggle = () => {
    const next = !overlay
    setOverlay(next)
    cameras.toggleOverlay(cam.id, next)
  }

  const handleReload = async () => {
    setReloading(true)
    setConnected(false)
    intentionalClose.current = true
    wsRef.current?.close()
    await cameras.reload(cam.id).catch(() => {})
    await new Promise(r => setTimeout(r, 1500))
    setWsKey(k => k + 1)
    setReloading(false)
  }

  const handleResetTracking = async () => {
    setResetting(true)
    await cameras.resetTracking(cam.id).catch(() => {})
    setResetting(false)
    setResetDone(true)
    setTimeout(() => setResetDone(false), 2000)
  }

  const handleNightMode = useCallback(async (mode) => {
    setNightMode(mode)
    try {
      const r = await cameras.setNightMode(cam.id, mode)
      setNightModeHw(r?.data?.hw ?? false)
    } catch {}
  }, [cam.id])

  const handleFullscreen = useCallback(() => {
    const el = videoContainerRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const displayName = cam.name || `Camera ${cam.id}`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          disabled={togglingEnabled}
          onClick={async () => {
            setTogglingEnabled(true)
            await cameras.setEnabled(cam.id, !cam.enabled).catch(() => {})
            onEnabledChange?.()
            setTogglingEnabled(false)
          }}
          className="relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50"
          style={{ background: cam.enabled ? '#22C55E' : '#3A3A3A' }}
          title={cam.enabled ? 'Disable camera' : 'Enable camera'}
        >
          <span
            className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all"
            style={{ left: cam.enabled ? '1.125rem' : '0.125rem' }}
          />
        </button>
        <button
          onClick={handleOverlayToggle}
          className="px-2.5 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80"
          style={overlay ? { background: '#FFB800', color: '#151925' } : { background: '#484848', color: '#ffffff' }}
        >
          {overlay ? 'Overlay On' : 'Overlay Off'}
        </button>
        <button
          onClick={handleReload}
          disabled={reloading || !alive}
          className="px-2.5 py-1 rounded text-xs font-medium bg-[#3A3A3A] hover:bg-[#484848] text-white transition-colors disabled:opacity-50"
          title="Stop and restart this camera"
        >
          {reloading ? 'Reloading…' : 'Reload'}
        </button>
        <button
          onClick={handleResetTracking}
          disabled={resetting || !alive}
          className="px-2.5 py-1 rounded text-xs font-medium bg-[#3A3A3A] hover:bg-[#484848] text-white transition-colors disabled:opacity-50"
          title="Reset AI motion tracking state"
        >
          {resetting ? 'Resetting…' : resetDone ? 'Reset ✓' : 'Reset AI'}
        </button>
        <button
          onClick={toggleDebug}
          disabled={!alive}
          className="px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50"
          style={debugMode ? { background: '#4c6e5d', color: '#ffffff' } : { background: '#3A3A3A', color: '#9CA3AF' }}
          title="Toggle live AI diagnostics"
        >
          Debug
        </button>
        {/* Most cameras switch IR on/off via an automatic photocell with no
            software hook at all, so there's nothing controllable to show —
            only render this when the camera actually exposes hardware control. */}
        {nightModeHw && (
          <div className="flex rounded overflow-hidden border border-[#484848]"
            title="Night vision — hardware IR LED control">
            {[['off','Off'],['auto','Auto'],['on','On']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => handleNightMode(val)}
                disabled={!alive}
                className="px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50"
                style={nightMode === val
                  ? { background: '#1a3a5c', color: '#60a5fa' }
                  : { background: '#2A2A2A', color: '#6B7280' }}
              >{label}</button>
            ))}
          </div>
        )}
        {children}
      </div>

      {overlay && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-600">Hide:</span>
          {OVERLAY_CATEGORIES.map(cat => {
            const hidden = hiddenCategories.has(cat)
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className="px-2 py-0.5 rounded text-xs font-medium capitalize transition-opacity hover:opacity-80"
                style={hidden ? CATEGORY_STYLE[cat].off : CATEGORY_STYLE[cat].on}
              >{cat}</button>
            )
          })}
        </div>
      )}

      <div ref={videoContainerRef} className="group relative bg-black rounded-lg overflow-hidden aspect-video">
        {playback ? (
          <>
            {playback.error ? (
              <div className="absolute inset-0 flex items-center justify-center text-red-400 text-sm text-center px-4">
                Failed to load that recording.
              </div>
            ) : (
              <video
                ref={playbackVideoRef}
                src={playback.url}
                controls
                autoPlay
                playsInline
                onEnded={onPlaybackEnded}
                onError={onPlaybackError}
                className="w-full h-full object-contain"
              />
            )}
            <button
              onClick={onGoLive}
              className="absolute top-2 left-2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 text-white text-xs font-medium hover:bg-black/80 transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              Go Live
            </button>
            {playback.label && (
              <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/50 text-white text-xs font-mono pointer-events-none select-none">
                {playback.label}
              </div>
            )}
          </>
        ) : !alive ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm text-center px-4">
            {cam.enabled === false
              ? 'Camera disabled'
              : cam.present === false
                ? 'Camera not detected — check the connection'
                : 'Camera offline — waiting to reconnect'}
          </div>
        ) : (
          <>
            {!connected && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
                {reloading ? 'Reloading camera…' : 'Connecting...'}
              </div>
            )}
            <img ref={imgRef} alt={displayName} className="w-full h-full object-contain" />
            {connected && cam.width && cam.height && (
              <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/50 text-white text-xs font-mono opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity pointer-events-none select-none">
                {cam.width}×{cam.height}{cam.stream_fps ? ` · ${cam.stream_fps}fps` : ''}
              </div>
            )}
            <button
              onClick={handleFullscreen}
              className="absolute bottom-2 right-2 p-1.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity hover:bg-black/70"
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M15 9h4.5M15 9V4.5M15 9l5.25-5.25M9 15H4.5M9 15v4.5M9 15l-5.25 5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
              )}
            </button>
          </>
        )}
      </div>

      {debugMode && <DebugPanel info={debugInfo} />}
    </div>
  )
})

export default CameraLiveView
