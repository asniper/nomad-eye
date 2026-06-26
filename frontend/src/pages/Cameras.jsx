import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { cameras, detections as detectionsApi } from '../api/client'
import { formatDateTime } from '../utils/dates'

const OVERLAY_CATEGORIES = ['people', 'vehicles', 'animals', 'faces', 'other']
const CATEGORY_STYLE = {
  people:   { on: { background: '#F87171', color: '#1a0000' }, off: { background: '#3A3A3A', color: '#F87171' } },
  vehicles: { on: { background: '#60A5FA', color: '#00001a' }, off: { background: '#3A3A3A', color: '#60A5FA' } },
  animals:  { on: { background: '#4ADE80', color: '#001a00' }, off: { background: '#3A3A3A', color: '#4ADE80' } },
  faces:    { on: { background: '#A855F7', color: '#ffffff' }, off: { background: '#3A3A3A', color: '#A855F7' } },
  other:    { on: { background: '#FCD34D', color: '#1a1500' }, off: { background: '#3A3A3A', color: '#FCD34D' } },
}
const DETECTION_BADGE = {
  people:   { background: 'rgba(239,68,68,0.15)',  color: '#F87171' },
  vehicles: { background: 'rgba(59,130,246,0.15)', color: '#60A5FA' },
  animals:  { background: 'rgba(34,197,94,0.15)',  color: '#4ADE80' },
  faces:    { background: 'rgba(168,85,247,0.15)', color: '#C084FC' },
  other:    { background: 'rgba(245,158,11,0.15)', color: '#FCD34D' },
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

function AdjustSlider({ label, min, max, step, value, onChange, format }) {
  const display = format ? format(value) : value
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-mono">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[#FFB800]"
        style={{ accentColor: '#FFB800' }}
      />
    </div>
  )
}

const HW_LABELS = {
  brightness: 'Brightness',
  contrast: 'Contrast',
  saturation: 'Saturation',
  hue: 'Hue',
  sharpness: 'Sharpness',
  gain: 'Gain',
  exposure_time_absolute: 'Exposure',
  white_balance_temperature: 'White Balance',
  zoom_absolute: 'Zoom',
  focus_absolute: 'Focus',
}

function AdjustPanel({ camId }) {
  const [loading, setLoading] = useState(true)
  const [hwControls, setHwControls] = useState({})
  const [hwValues, setHwValues] = useState({})
  const [swBrightness, setSwBrightness] = useState(0)
  const [swContrast, setSwContrast] = useState(1.0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    cameras.getControls(camId)
      .then(r => {
        const { hw_controls, hw_adjustments, sw_brightness, sw_contrast } = r.data
        setHwControls(hw_controls)
        const init = {}
        for (const [name, ctrl] of Object.entries(hw_controls)) {
          init[name] = hw_adjustments[name] ?? ctrl.value
        }
        setHwValues(init)
        setSwBrightness(sw_brightness ?? 0)
        setSwContrast(sw_contrast ?? 1.0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [camId])

  const handleSave = async () => {
    setSaving(true)
    try {
      await cameras.setAdjustments(camId, { hw: hwValues, sw_brightness: swBrightness, sw_contrast: swContrast })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {}
    setSaving(false)
  }

  const handleReset = () => {
    const resetHw = {}
    for (const [name, ctrl] of Object.entries(hwControls)) {
      resetHw[name] = ctrl.default
    }
    setHwValues(resetHw)
    setSwBrightness(0)
    setSwContrast(1.0)
  }

  const intControls = Object.entries(hwControls).filter(([, c]) => c.type === 'int' || c.type === 'int64')

  if (loading) {
    return (
      <div className="rounded-lg bg-[#1A1A1A] border border-[#3A3A3A] px-3 py-3 text-xs text-gray-600">
        Loading controls...
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-[#1A1A1A] border border-[#3A3A3A] px-4 py-3 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Adjustments</span>
        <div className="flex items-center gap-3">
          <button onClick={handleReset} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Reset defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50"
            style={{ background: saved ? '#22C55E' : '#FFB800', color: saved ? '#fff' : '#151925' }}
          >
            {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>

      {intControls.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-600 mb-2">Hardware</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {intControls.map(([name, ctrl]) => (
              <AdjustSlider
                key={name}
                label={HW_LABELS[name] || name.replace(/_/g, ' ')}
                min={ctrl.min}
                max={ctrl.max}
                step={ctrl.step}
                value={hwValues[name] ?? ctrl.value}
                onChange={v => setHwValues(prev => ({ ...prev, [name]: v }))}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-xs font-medium text-gray-600 mb-2">Software</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <AdjustSlider
            label="Brightness"
            min={-100}
            max={100}
            step={1}
            value={swBrightness}
            onChange={setSwBrightness}
          />
          <AdjustSlider
            label="Contrast"
            min={0.5}
            max={3.0}
            step={0.05}
            value={swContrast}
            onChange={setSwContrast}
            format={v => v.toFixed(2)}
          />
        </div>
      </div>
    </div>
  )
}

function FacePanel({ cam, onUpdate }) {
  const [enabled, setEnabled] = useState(cam.face_detection_enabled ?? true)
  const [sensitivity, setSensitivity] = useState(cam.face_sensitivity ?? 'normal')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const save = async (patch) => {
    setSaving(true); setSaveError(null)
    try {
      await cameras.setFaceSettings(cam.id, patch)
      setSaved(true)
      if (onUpdate) onUpdate(patch)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setSaveError(e?.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleEnabled = async (val) => {
    setEnabled(val)
    await save({ face_detection_enabled: val })
  }

  const handleSensitivity = async (val) => {
    setSensitivity(val)
    await save({ face_sensitivity: val })
  }

  return (
    <div className="rounded-lg bg-[#1A1A1A] border border-[#3A3A3A] px-4 py-3 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Face Detection</span>
        {saved && <span className="text-xs text-green-400">Saved ✓</span>}
        {saving && !saved && <span className="text-xs text-gray-500">Saving…</span>}
        {saveError && <span className="text-xs text-red-400">{saveError}</span>}
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white">Enabled</p>
          <p className="text-xs text-gray-500 mt-0.5">Detect and recognize faces on this camera</p>
        </div>
        <button
          onClick={() => handleEnabled(!enabled)}
          className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
          style={{ background: enabled ? '#FFB800' : '#3A3A3A' }}
        >
          <span
            className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
            style={{ transform: enabled ? 'translateX(1.4rem)' : 'translateX(0.2rem)' }}
          />
        </button>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-white">Sensitivity</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Fast: ~0.5s · Normal: ~1.1s fallback · Thorough: ~2s
          </p>
        </div>
        <select
          value={sensitivity}
          onChange={e => handleSensitivity(e.target.value)}
          className="bg-[#3A3A3A] border border-[#484848] rounded-md px-2 py-1 text-sm text-white focus:outline-none shrink-0"
        >
          <option value="fast">Fast</option>
          <option value="normal">Normal</option>
          <option value="thorough">Thorough</option>
        </select>
      </div>
    </div>
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

function Row({ label, value }) {
  return (
    <>
      <span className="text-gray-600">{label}</span>
      <span className="text-gray-300">{value}</span>
    </>
  )
}

function CameraDetections({ camId }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    detectionsApi.list({ camera_id: camId, limit: 20 })
      .then(r => setRows(r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [camId])

  if (loading) return <div className="pt-3 pb-1 text-center text-xs text-gray-500">Loading...</div>
  if (!rows?.length) return <div className="pt-3 pb-1 text-center text-xs text-gray-500">No detections for this camera yet.</div>

  return (
    <div className="overflow-x-auto mt-1">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#3A3A3A]">
            {['', 'Category', 'Label', 'Confidence', 'Time'].map((h, i) => (
              <th key={i} className={`pb-2 text-xs font-medium text-gray-500 uppercase tracking-wider ${i === 4 ? 'text-right pl-3' : 'text-left'} ${i > 0 ? 'pl-3' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#2A2A2A]">
          {rows.map(d => (
            <tr key={d.id}>
              <td className="py-2 pr-3">
                <Link
                  to={d.event_id ? `/events/${d.event_id}` : `/detections`}
                  className="text-xs hover:text-white transition-colors"
                  style={{ color: '#FFB800' }}
                >
                  View
                </Link>
              </td>
              <td className="py-2 pl-3 pr-3">
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                  style={DETECTION_BADGE[d.category] || DETECTION_BADGE.other}
                >{d.category}</span>
              </td>
              <td className="py-2 pl-3 pr-3 text-xs text-gray-200 capitalize">{d.label}</td>
              <td className="py-2 pl-3 pr-3 text-xs text-gray-400">{Math.round(d.confidence * 100)}%</td>
              <td className="py-2 pl-3 text-right text-xs text-gray-400 whitespace-nowrap">{formatDateTime(d.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link to={`/detections?camera=${camId}`} className="block mt-2 text-xs hover:text-white transition-colors" style={{ color: '#FFB800' }}>
        View all for this camera →
      </Link>
    </div>
  )
}

function OfflineToggle({ cam, onEnabledChange }) {
  const [toggling, setToggling] = useState(false)
  return (
    <button
      disabled={toggling}
      onClick={async () => {
        setToggling(true)
        await cameras.setEnabled(cam.id, !cam.enabled).catch(() => {})
        onEnabledChange()
        setToggling(false)
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
  )
}

function CameraFeed({ cam, onNameSaved, onEnabledChange }) {
  const imgRef = useRef(null)
  const wsRef = useRef(null)
  const [camData, setCamData] = useState(cam)
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

  const [name, setName] = useState(cam.name || '')
  const [editingName, setEditingName] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState(false)
  const [showDetections, setShowDetections] = useState(false)
  const [showAdjust, setShowAdjust] = useState(false)
  const [showFace, setShowFace] = useState(false)
  const [nightMode, setNightMode] = useState(cam.night_mode || 'off')
  const [nightModeHw, setNightModeHw] = useState(cam.night_mode_hw || false)
  const [debugMode, setDebugMode] = useState(false)
  const [debugInfo, setDebugInfo] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [togglingEnabled, setTogglingEnabled] = useState(false)
  const videoContainerRef = useRef(null)

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

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/api/cameras/${cam.id}/stream`)
    wsRef.current = ws
    ws.binaryType = 'blob'
    ws.onopen = () => {
      setConnected(true)
      sendFilter(hiddenCategories)
      if (debugMode) ws.send(JSON.stringify({ debug: true }))
    }
    ws.onclose = () => {
      setConnected(false)
      if (!intentionalClose.current) {
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
      fpsCountRef.current++
    }
    const fpsTimer = setInterval(() => { setFps(fpsCountRef.current); fpsCountRef.current = 0 }, 1000)
    return () => { intentionalClose.current = true; ws.close(); clearInterval(fpsTimer) }
  }, [cam.id, wsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOverlayToggle = () => {
    const next = !overlay
    setOverlay(next)
    cameras.toggleOverlay(cam.id, next)
  }

  const saveName = async () => {
    setEditingName(false)
    const trimmed = name.trim()
    if (trimmed !== cam.name) {
      await cameras.setName(cam.id, trimmed).catch(() => {})
      onNameSaved(cam.id, trimmed)
    }
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
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {editingName ? (
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setName(cam.name || ''); setEditingName(false) } }}
                className="bg-[#3A3A3A] border border-[#4c6e5d] rounded px-2 py-0.5 text-sm text-white focus:outline-none w-36"
              />
            ) : (
              <button
                onClick={() => setEditingName(true)}
                className="font-semibold text-white hover:text-[#FFB800] transition-colors text-left truncate"
                title="Click to rename"
              >
                {displayName}
              </button>
            )}
            <Badge label={reloading ? 'Reloading' : connected ? 'Live' : 'Offline'} color={reloading ? 'yellow' : connected ? 'green' : 'red'} />
            {connected && !reloading && <span className="text-xs text-gray-500">{fps} fps</span>}
          </div>
          {(cam.device || cam.usb_id) && (
            <div className="flex items-center gap-2 flex-wrap">
              {cam.device && <span className="text-xs text-gray-600 font-mono">{cam.device}</span>}
              {cam.usb_id && cam.usb_id !== cam.device?.replace('/dev/', '') && (
                <span className="text-xs text-gray-700 truncate max-w-[220px]" title={cam.usb_id}>
                  {cam.usb_id.replace(/-video-index\d+$/, '')}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            disabled={togglingEnabled}
            onClick={async () => {
              setTogglingEnabled(true)
              await cameras.setEnabled(cam.id, !cam.enabled).catch(() => {})
              onEnabledChange()
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
            disabled={reloading}
            className="px-2.5 py-1 rounded text-xs font-medium bg-[#3A3A3A] hover:bg-[#484848] text-white transition-colors disabled:opacity-50"
            title="Stop and restart this camera"
          >
            {reloading ? 'Reloading…' : 'Reload'}
          </button>
          <button
            onClick={handleResetTracking}
            disabled={resetting}
            className="px-2.5 py-1 rounded text-xs font-medium bg-[#3A3A3A] hover:bg-[#484848] text-white transition-colors disabled:opacity-50"
            title="Reset AI motion tracking state"
          >
            {resetting ? 'Resetting…' : resetDone ? 'Reset ✓' : 'Reset AI'}
          </button>
          <button
            onClick={toggleDebug}
            className="px-2.5 py-1 rounded text-xs font-medium transition-colors"
            style={debugMode ? { background: '#4c6e5d', color: '#ffffff' } : { background: '#3A3A3A', color: '#9CA3AF' }}
            title="Toggle live AI diagnostics"
          >
            Debug
          </button>
          <button
            onClick={() => setShowAdjust(p => !p)}
            className="px-2.5 py-1 rounded text-xs font-medium transition-colors"
            style={showAdjust ? { background: '#4c6e5d', color: '#ffffff' } : { background: '#3A3A3A', color: '#9CA3AF' }}
            title="Camera adjustments"
          >
            Adjust
          </button>
          <div className="flex items-center gap-1">
            <div className="flex rounded overflow-hidden border border-[#484848]"
              title={nightModeHw
                ? 'Night vision — hardware IR LED control'
                : 'Night vision — software brightness boost (camera IR is hardware-only)'}>
              {[['off','Off'],['auto','Auto'],['on','On']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => handleNightMode(val)}
                  className="px-2 py-1 text-xs font-medium transition-colors"
                  style={nightMode === val
                    ? { background: '#1a3a5c', color: '#60a5fa' }
                    : { background: '#2A2A2A', color: '#6B7280' }}
                >{label}</button>
              ))}
            </div>
            {nightMode !== 'off' && (
              <span className="text-xs" style={{ color: nightModeHw ? '#60a5fa' : '#6B7280' }}
                title={nightModeHw ? 'Hardware IR LEDs controlled' : 'Software boost — IR LEDs controlled by onboard photocell'}>
                {nightModeHw ? 'IR' : 'SW'}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowFace(p => !p)}
            className="px-2.5 py-1 rounded text-xs font-medium transition-colors"
            style={showFace ? { background: '#4c3a6e', color: '#C084FC' } : { background: '#3A3A3A', color: '#A855F7' }}
            title="Face detection settings"
          >
            Face
          </button>
        </div>
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
      </div>

      {debugMode && (
        <DebugPanel info={debugInfo} />
      )}

      {showAdjust && (
        <AdjustPanel camId={cam.id} />
      )}

      {showFace && (
        <FacePanel cam={camData} onUpdate={patch => setCamData(prev => ({ ...prev, ...patch }))} />
      )}

      <button
        onClick={() => setShowDetections(p => !p)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors pt-1 w-full"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform duration-200 ${showDetections ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        Recent Detections
      </button>

      {showDetections && (
        <div className="border-t border-[#3A3A3A] pt-3">
          <CameraDetections camId={cam.id} />
        </div>
      )}
    </Card>
  )
}

export default function Cameras() {
  const [cams, setCams] = useState([])
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState(null)

  const handleRemove = async (id) => {
    await cameras.remove(id).catch(() => {})
    setCams(prev => prev.filter(c => c.id !== id))
  }

  const loadCameras = useCallback(() => {
    return cameras.list()
      .then(r => { setCams(r.data); setError(null) })
      .catch(() => setError('Could not load cameras. Make sure the detection pipeline is running.'))
  }, [])

  useEffect(() => { loadCameras().finally(() => setLoading(false)) }, [loadCameras])

  const handleDetect = async () => {
    setDetecting(true)
    setError(null)
    try {
      const r = await cameras.refresh()
      setCams(r.data)
    } catch {
      setError('Camera scan failed.')
    } finally {
      setDetecting(false)
    }
  }

  const handleNameSaved = (id, newName) => {
    setCams(prev => prev.map(c => c.id === id ? { ...c, name: newName } : c))
  }

  const handleEnabledChange = useCallback(() => { loadCameras() }, [loadCameras])

  if (loading) return <div className="text-gray-500 text-sm">Loading cameras...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold" style={{ color: '#FFB800' }}>Cameras</h2>
        <button
          onClick={handleDetect}
          disabled={detecting}
          className="flex items-center gap-2 px-4 py-2 disabled:opacity-50 text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          style={{ background: '#FFB800', color: '#151925' }}
        >
          <svg className={`w-4 h-4 ${detecting ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {detecting ? 'Scanning...' : 'Detect Cameras'}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</p>
      )}

      {!error && cams.length === 0 && (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
          <p className="text-gray-500 text-sm">No cameras detected.</p>
          <p className="text-gray-600 text-xs mt-1">Plug in a USB camera and press Detect Cameras.</p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {cams.map(cam => {
          if (cam.alive) {
            return <CameraFeed key={cam.id} cam={cam} onNameSaved={handleNameSaved} onEnabledChange={handleEnabledChange} />
          }
          if (cam.present) {
            return (
              <div key={cam.id} className="bg-[#2E2E2E] rounded-xl p-4 border border-[#3A3A3A] flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white">{cam.name || `Camera ${cam.id}`}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {cam.usb_id?.replace(/-video-index\d+$/, '') || 'Unknown device'} — {cam.enabled ? 'connecting…' : 'disabled'}
                  </p>
                  {cam.last_seen && <p className="text-xs text-gray-700 mt-0.5">Last seen {new Date(cam.last_seen).toLocaleString()}</p>}
                </div>
                <OfflineToggle cam={cam} onEnabledChange={handleEnabledChange} />
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}
