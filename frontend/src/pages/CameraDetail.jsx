import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import Card from '../components/Card'
import Badge from '../components/Badge'
import CameraLiveView, { OVERLAY_CATEGORIES, CATEGORY_STYLE, statusBadge } from '../components/CameraLiveView'
import ReanalyzeModal from '../components/ReanalyzeModal'
import { cameras, detections as detectionsApi } from '../api/client'
import { formatDateTime, getTimezone, zonedTimeToUtcIso } from '../utils/dates'
import { useConfirm } from '../context/ConfirmContext'

const DETECTION_BADGE = {
  people:   { background: 'rgba(239,68,68,0.15)',  color: '#F87171' },
  vehicles: { background: 'rgba(59,130,246,0.15)', color: '#60A5FA' },
  animals:  { background: 'rgba(34,197,94,0.15)',  color: '#4ADE80' },
  faces:    { background: 'rgba(168,85,247,0.15)', color: '#C084FC' },
  other:    { background: 'rgba(245,158,11,0.15)', color: '#FCD34D' },
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
const ZONE_FILL = { include: 'rgba(74,222,128,0.35)', exclude: 'rgba(239,68,68,0.35)' }
const ZONE_STROKE = { include: '#4ADE80', exclude: '#F87171' }

const TABS = [
  { key: 'continuous', label: 'Continuous' },
  { key: 'zones', label: 'Zones' },
  { key: 'adjust', label: 'Adjust' },
  { key: 'face', label: 'Face' },
  { key: 'history', label: 'History' },
]

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

// ---------------------------------------------------------------------------
// Panels relocated from the Cameras list page — unchanged from their previous
// behavior, just moved here so they have real screen space.
// ---------------------------------------------------------------------------

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

function ZoneEditor({ camId }) {
  const confirm = useConfirm()
  const [imgUrl, setImgUrl] = useState(null)
  const [zones, setZones] = useState([])
  const [loading, setLoading] = useState(true)
  const [drafting, setDrafting] = useState(false)
  const [draftPoints, setDraftPoints] = useState([])
  const [draftType, setDraftType] = useState('exclude')
  const [draftCategories, setDraftCategories] = useState(() => new Set())
  const [draftName, setDraftName] = useState('')
  const [error, setError] = useState('')
  const svgRef = useRef(null)
  const imgUrlRef = useRef(null)

  const load = useCallback(() => {
    setError('')
    Promise.all([
      cameras.snapshot(camId).then(r => r.data),
      cameras.listZones(camId).then(r => r.data),
    ]).then(([blob, zoneList]) => {
      const url = URL.createObjectURL(blob)
      if (imgUrlRef.current) URL.revokeObjectURL(imgUrlRef.current)
      imgUrlRef.current = url
      setImgUrl(url)
      setZones(zoneList)
    }).catch(() => setError('Failed to load camera snapshot — is the camera live?'))
      .finally(() => setLoading(false))
  }, [camId])

  useEffect(() => {
    load()
    return () => { if (imgUrlRef.current) URL.revokeObjectURL(imgUrlRef.current) }
  }, [load])

  const handleSvgClick = (e) => {
    if (!drafting) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    setDraftPoints(p => [...p, [x, y]])
  }

  const startDraft = () => {
    setDrafting(true); setDraftPoints([]); setDraftName('')
    setDraftType('exclude'); setDraftCategories(new Set()); setError('')
  }

  const cancelDraft = () => { setDrafting(false); setDraftPoints([]) }

  const toggleCategory = (cat) => {
    setDraftCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  const saveDraft = async () => {
    if (draftPoints.length < 3) { setError('Draw at least 3 points before saving.'); return }
    try {
      await cameras.createZone(camId, {
        name: draftName,
        zone_type: draftType,
        categories: draftCategories.size > 0 ? [...draftCategories] : null,
        points: draftPoints,
      })
      cancelDraft()
      load()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to save zone.')
    }
  }

  const removeZone = async (zoneId) => {
    try {
      await cameras.deleteZone(camId, zoneId)
      load()
    } catch {}
  }

  if (loading) {
    return (
      <div className="rounded-lg bg-[#1A1A1A] border border-[#3A3A3A] px-3 py-3 text-xs text-gray-600">
        Loading zones...
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-[#1A1A1A] border border-[#3A3A3A] px-4 py-3 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Detection Zones</span>
        {!drafting ? (
          <button onClick={startDraft} disabled={!imgUrl}
            className="px-3 py-1 rounded text-xs font-medium disabled:opacity-40"
            style={{ background: '#FFB800', color: '#151925' }}>
            Draw New Zone
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{draftPoints.length} point{draftPoints.length === 1 ? '' : 's'} (need 3+)</span>
            <button onClick={cancelDraft} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
            <button onClick={saveDraft} disabled={draftPoints.length < 3}
              className="px-3 py-1 rounded text-xs font-medium disabled:opacity-40"
              style={{ background: ZONE_STROKE.include, color: '#001a00' }}>
              Save Zone
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {drafting && (
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <input
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            placeholder="Zone name (optional)"
            className="bg-[#3A3A3A] border border-[#484848] rounded px-2 py-1 text-white focus:outline-none"
          />
          <div className="flex rounded overflow-hidden border border-[#484848]">
            {['exclude', 'include'].map(t => (
              <button key={t} onClick={() => setDraftType(t)}
                className="px-2.5 py-1 font-medium capitalize"
                style={draftType === t ? { background: ZONE_STROKE[t], color: '#111' } : { background: '#2A2A2A', color: '#9CA3AF' }}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex gap-1 flex-wrap">
            {OVERLAY_CATEGORIES.map(cat => (
              <button key={cat} onClick={() => toggleCategory(cat)}
                className="px-2 py-1 rounded capitalize"
                style={draftCategories.has(cat) ? CATEGORY_STYLE[cat].on : CATEGORY_STYLE[cat].off}>
                {cat}
              </button>
            ))}
          </div>
          <span className="text-gray-600">{draftCategories.size === 0 ? '(applies to all categories)' : ''}</span>
        </div>
      )}

      <div className="relative rounded overflow-hidden" style={{ maxWidth: '640px' }}>
        {imgUrl && <img src={imgUrl} alt="" className="w-full block" draggable={false} />}
        <svg
          ref={svgRef}
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
          style={{ cursor: drafting ? 'crosshair' : 'default' }}
          onClick={handleSvgClick}
        >
          {zones.map(z => (
            <polygon
              key={z.id}
              points={z.points.map(p => p.join(',')).join(' ')}
              fill={ZONE_FILL[z.zone_type]}
              stroke={ZONE_STROKE[z.zone_type]}
              strokeWidth={0.004}
            />
          ))}
          {drafting && draftPoints.length > 0 && (
            <polyline
              points={draftPoints.map(p => p.join(',')).join(' ')}
              fill="none"
              stroke={ZONE_STROKE[draftType]}
              strokeWidth={0.004}
            />
          )}
          {drafting && draftPoints.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={0.008} fill={ZONE_STROKE[draftType]} />
          ))}
        </svg>
      </div>

      {zones.length > 0 ? (
        <div className="space-y-1">
          {zones.map(z => (
            <div key={z.id} className="flex items-center justify-between flex-wrap gap-2 text-xs">
              <span className="min-w-0 break-words" style={{ color: ZONE_STROKE[z.zone_type] }}>
                {z.zone_type === 'exclude' ? 'Ignore' : 'Only'}{z.name ? ` "${z.name}"` : ''} — {z.categories ? z.categories.join(', ') : 'all categories'}
              </span>
              <button onClick={() => removeZone(z.id)} className="text-gray-500 hover:text-red-400 shrink-0">Delete</button>
            </div>
          ))}
        </div>
      ) : (
        !drafting && <p className="text-xs text-gray-600">No zones yet — the whole frame is detected normally.</p>
      )}
    </div>
  )
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

function CameraDetections({ camId }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    detectionsApi.list({ camera_id: camId, limit: 50 })
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

// ---------------------------------------------------------------------------
// Continuous Recording — segment-block day timeline
// ---------------------------------------------------------------------------

function todayStr(tz) {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz })
}

function shiftDay(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

function formatDayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function localMinutesOfDay(isoUtc, tz) {
  const str = new Date(isoUtc).toLocaleTimeString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' })
  const [h, m] = str.split(':').map(Number)
  return ((h % 24) * 60 + m) % 1440 // some ICU builds format midnight as "24:00" rather than "00:00"
}

// getTimezone() can return a stale/invalid IANA name (e.g. tampered localStorage);
// formatDateTime/formatTime in utils/dates.js guard against this the same way.
function safeTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

const SEGMENT_MINUTES = 5

// ---------------------------------------------------------------------------

export default function CameraDetail() {
  const { cameraId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab = TABS.some(t => t.key === rawTab) ? rawTab : 'continuous'

  const [cam, setCam] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [name, setName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [status, setStatus] = useState({ connected: false, reloading: false, fps: 0 })
  const tz = safeTz(getTimezone())

  // Playback state, the day-timeline, and the goto-date/time lookup all live
  // here rather than in a tab-scoped child — the timeline (and the shared
  // player above it) needs to stay visible and usable from any tab, not just
  // while the Continuous tab happens to be selected.
  const [selectedSegment, setSelectedSegment] = useState(null)
  const [playbackError, setPlaybackError] = useState(false)
  const [lockBusy, setLockBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const videoCardRef = useRef(null)
  const liveViewRef = useRef(null)
  const selectedSegmentRef = useRef(null)
  useEffect(() => { selectedSegmentRef.current = selectedSegment }, [selectedSegment])

  const [summary, setSummary] = useState(null)
  const [dateStr, setDateStr] = useState(() => todayStr(tz))
  const [segments, setSegments] = useState([])
  const [dayLoading, setDayLoading] = useState(true)
  const [dayError, setDayError] = useState('')
  const [nowMinutes, setNowMinutes] = useState(() => localMinutesOfDay(new Date().toISOString(), tz))
  const isMountRef = useRef(true)
  const dayRequestRef = useRef(0)

  const [gotoValue, setGotoValue] = useState('')
  const [gotoError, setGotoError] = useState('')
  const [gotoLoading, setGotoLoading] = useState(false)

  const [lockedSegments, setLockedSegments] = useState([])
  const [editingDescId, setEditingDescId] = useState(null)
  const [descDraft, setDescDraft] = useState('')
  const [savingDesc, setSavingDesc] = useState(false)
  const [reanalyzeSeg, setReanalyzeSeg] = useState(null)
  const [reanalyzeUrl, setReanalyzeUrl] = useState(null)
  const lockedRequestRef = useRef(0)

  const isToday = dateStr === todayStr(tz)

  const segmentsWithMinutes = useMemo(
    () => segments.map(seg => ({ ...seg, startMin: localMinutesOfDay(seg.started_at, tz) })),
    [segments, tz]
  )

  // "Next"/"Prev" and auto-advance only make sense within the currently
  // loaded day's list — a segment selected from the Locked Recordings section
  // or a goto lookup (which can land on any day) won't be found here, and
  // next/prev simply have nothing to offer for it, same as the disabled state.
  const selectedIndex = selectedSegment ? segmentsWithMinutes.findIndex(s => s.id === selectedSegment.id) : -1
  const nextSegment = selectedIndex >= 0 ? segmentsWithMinutes[selectedIndex + 1] || null : null
  const prevSegment = selectedIndex > 0 ? segmentsWithMinutes[selectedIndex - 1] : null
  const advanceRef = useRef(null)
  const prevRef = useRef(null)
  const handlePlaybackEnded = useCallback(() => { advanceRef.current?.() }, [])

  // Streamed directly via <video src> (token in the query string — see
  // withToken in api/client.js), not fetched as a blob — the browser handles
  // buffering/range requests/seeking natively, so there's no fetch to await,
  // no prefetch-ahead-of-time to manage, and no object URL lifecycle to track.
  const videoUrl = selectedSegment ? detectionsApi.continuousStreamUrl(selectedSegment.id) : null

  const reload = useCallback(() => {
    return cameras.list().then(r => {
      const found = r.data.find(c => c.id === Number(cameraId))
      if (!found) { setNotFound(true); return }
      setNotFound(false)
      setCam(found)
      setName(found.name || '')
    }).catch(() => setNotFound(true))
  }, [cameraId])

  useEffect(() => { reload().finally(() => setLoading(false)) }, [reload])

  const goLive = useCallback(() => {
    setSelectedSegment(null)
    setPlaybackError(false)
  }, [])

  // This component doesn't remount across /cameras/:id navigation (same route,
  // just a changed param), so playback state from the previous camera has to
  // be explicitly cleared rather than relying on fresh initial state.
  useEffect(() => { goLive() }, [cameraId, goLive])

  const selectSegment = useCallback((seg, { scrollIntoView = true, switchTab = false } = {}) => {
    setSelectedSegment(seg)
    setPlaybackError(false)
    // The timeline (and goto) are visible from any tab now — switch to
    // Continuous so the day list/Locked Recordings context is actually
    // visible too, matching what got clicked.
    if (switchTab) setSearchParams({})
    // Skip the scroll for auto-advance (video ended naturally) — the user is
    // already looking at the player, so yanking scroll position back to it
    // every ~5 minutes as segments roll over would just be annoying. Explicit
    // selections (timeline, locked list, Next/Prev, goto) still snap to it.
    if (scrollIntoView) videoCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [setSearchParams])

  useEffect(() => {
    advanceRef.current = nextSegment ? () => selectSegment(nextSegment, { scrollIntoView: false }) : null
    prevRef.current = prevSegment ? () => selectSegment(prevSegment, { scrollIntoView: false }) : null
  }, [nextSegment, prevSegment, selectSegment])

  // Keeps the timeline's day view pointed at whatever's actually selected —
  // covers Locked Recordings (any day) and goto (any day) landing on a
  // segment outside the day currently shown.
  useEffect(() => {
    if (!selectedSegment) return
    const segDay = new Date(selectedSegment.started_at).toLocaleDateString('en-CA', { timeZone: tz })
    setDateStr(prev => prev === segDay ? prev : segDay)
  }, [selectedSegment, tz])

  const toggleLock = useCallback(async () => {
    const seg = selectedSegment
    if (!seg) return
    setLockBusy(true)
    setActionError('')
    const next = !seg.locked
    try {
      await detectionsApi.lockContinuous(seg.id, next)
      // Only apply if still the active selection — the user may have picked
      // something else while this request was in flight.
      if (selectedSegmentRef.current?.id === seg.id) {
        setSelectedSegment(prev => prev ? { ...prev, locked: next } : prev)
      }
      setSegments(prev => prev.map(s => s.id === seg.id ? { ...s, locked: next } : s))
      loadLocked()
    } catch {
      setActionError('Failed to update lock.')
    } finally {
      setLockBusy(false)
    }
  }, [selectedSegment]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteSegment = useCallback(async () => {
    const seg = selectedSegment
    if (!seg) return
    const msg = seg.locked
      ? 'This recording is locked. Delete it anyway?'
      : 'Delete this recording?'
    if (!window.confirm(msg)) return
    setDeleteBusy(true)
    setActionError('')
    try {
      await detectionsApi.deleteContinuous(seg.id)
      setSegments(prev => prev.filter(s => s.id !== seg.id))
      if (cam) detectionsApi.continuousSummary(cam.id).then(r => setSummary(r.data)).catch(() => {})
      loadLocked()
      if (selectedSegmentRef.current?.id === seg.id) goLive()
    } catch {
      setActionError('Failed to delete recording.')
    } finally {
      setDeleteBusy(false)
    }
  }, [selectedSegment, goLive, cam]) // eslint-disable-line react-hooks/exhaustive-deps

  const downloadSegment = () => {
    if (!videoUrl || !selectedSegment) return
    const a = document.createElement('a')
    a.href = videoUrl
    a.download = `continuous-cam${cam?.id}-${selectedSegment.id}.mp4`
    a.click()
  }

  const saveName = async () => {
    setEditingName(false)
    const trimmed = name.trim()
    if (cam && trimmed !== cam.name) {
      await cameras.setName(cam.id, trimmed).catch(() => {})
      setCam(prev => ({ ...prev, name: trimmed }))
    }
  }

  useEffect(() => {
    if (!cam) return
    detectionsApi.continuousSummary(cam.id).then(r => setSummary(r.data)).catch(() => {})
  }, [cam])

  const loadLocked = useCallback(() => {
    if (!cam) return
    const requestId = ++lockedRequestRef.current
    detectionsApi.listLockedContinuous(cam.id)
      .then(r => { if (requestId === lockedRequestRef.current) setLockedSegments(r.data) })
      .catch(() => {})
  }, [cam])

  useEffect(() => { loadLocked() }, [loadLocked])

  useEffect(() => {
    if (!isToday) return
    const t = setInterval(() => setNowMinutes(localMinutesOfDay(new Date().toISOString(), tz)), 30000)
    return () => clearInterval(t)
  }, [isToday, tz])

  const loadDay = useCallback(() => {
    if (!cam) return
    setDayLoading(true)
    setDayError('')
    const requestId = ++dayRequestRef.current
    detectionsApi.listContinuous(cam.id, dateStr, tz)
      // The API returns SQLite's raw 0/1 for `locked` — normalize to a real
      // boolean here so every consumer (render, toggle, timeline color) can
      // trust it, instead of each one needing its own truthiness workaround.
      .then(r => {
        // Rapid Prev/Next clicks can resolve out of order — only apply the
        // response that matches the day currently being requested.
        if (requestId === dayRequestRef.current) setSegments(r.data.map(s => ({ ...s, locked: !!s.locked })))
      })
      .catch(() => { if (requestId === dayRequestRef.current) setDayError('Failed to load recordings for this day.') })
      .finally(() => { if (requestId === dayRequestRef.current) setDayLoading(false) })
  }, [cam, dateStr, tz])

  useEffect(() => {
    loadDay()
    // Changing the day (Prev/Next/Jump-to-today) should drop back to live —
    // but not on the very first load, or every page load would immediately
    // "go live" despite selectedSegment already being null at that point.
    if (!isMountRef.current) goLive()
    isMountRef.current = false
  }, [loadDay]) // eslint-disable-line react-hooks/exhaustive-deps

  const startEditingDesc = (seg) => {
    setEditingDescId(seg.id)
    setDescDraft(seg.description || '')
  }

  const cancelEditingDesc = () => {
    setEditingDescId(null)
    setDescDraft('')
  }

  const saveDesc = async (segId) => {
    setSavingDesc(true)
    try {
      await detectionsApi.setContinuousDescription(segId, descDraft)
      setLockedSegments(prev => prev.map(s => s.id === segId ? { ...s, description: descDraft.trim() } : s))
      setEditingDescId(null)
      setDescDraft('')
    } catch {}
    setSavingDesc(false)
  }

  // Builds its own stream URL rather than reusing the shared player's — the
  // Locked Recordings list can open this for any segment regardless of which
  // one (if any) is currently selected/playing.
  const openReanalyze = (seg) => {
    setReanalyzeUrl(detectionsApi.continuousStreamUrl(seg.id))
    setReanalyzeSeg(seg)
  }

  const closeReanalyze = () => {
    setReanalyzeUrl(null)
    setReanalyzeSeg(null)
  }

  const handleGoto = async () => {
    if (!gotoValue || !cam) return
    setGotoLoading(true)
    setGotoError('')
    try {
      const atIso = zonedTimeToUtcIso(gotoValue, tz)
      const r = await detectionsApi.findContinuous(cam.id, atIso)
      if (!r.data.found) {
        setGotoError("No recording exists for that date/time — it may never have been recorded, or has since been purged.")
      } else {
        selectSegment({
          id: r.data.segment_id,
          started_at: r.data.started_at,
          locked: r.data.locked,
          description: r.data.description,
        }, { switchTab: true })
        const seekSeconds = r.data.offset_seconds
        requestAnimationFrame(() => liveViewRef.current?.seekTo(seekSeconds))
      }
    } catch {
      setGotoError('Lookup failed.')
    } finally {
      setGotoLoading(false)
    }
  }

  const oldestDateStr = summary?.oldest_started_at
    ? new Date(summary.oldest_started_at).toLocaleDateString('en-CA', { timeZone: tz })
    : null
  const atOldest = oldestDateStr != null && dateStr <= oldestDateStr

  const approxMinutes = (summary?.segment_count || 0) * SEGMENT_MINUTES
  const approxDuration = approxMinutes >= 60
    ? `${Math.floor(approxMinutes / 60)}h ${approxMinutes % 60}m`
    : `${approxMinutes}m`

  if (loading) return <div className="text-gray-500 text-sm">Loading camera...</div>
  if (notFound || !cam) return (
    <div className="space-y-4">
      <Link to="/cameras" className="text-sm hover:underline" style={{ color: '#FFB800' }}>← Back to Cameras</Link>
      <p className="text-red-400 text-sm">Camera not found.</p>
    </div>
  )

  const displayName = cam.name || `Camera ${cam.id}`
  const badge = statusBadge(status)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/cameras" className="text-sm hover:underline" style={{ color: '#FFB800' }}>← Cameras</Link>
        {editingName ? (
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setName(cam.name || ''); setEditingName(false) } }}
            className="bg-[#3A3A3A] border border-[#4c6e5d] rounded px-2 py-1 text-lg text-white focus:outline-none"
          />
        ) : (
          <button onClick={() => setEditingName(true)} className="text-2xl font-bold hover:opacity-80 transition-opacity" style={{ color: '#FFB800' }} title="Click to rename">
            {displayName}
          </button>
        )}
        <Badge label={badge.label} color={badge.color} />
        {status.connected && !status.reloading && <span className="text-xs text-gray-500">{status.fps} fps</span>}
      </div>

      <div ref={videoCardRef}>
        <Card>
          {/* key={cam.id} forces a remount on navigation between two /cameras/:id URLs
              (same route, changed param) — without it CameraLiveView's internal state
              (hidden categories, debug mode, night mode, overlay) would carry over
              from whichever camera was previously shown. */}
          <CameraLiveView
            ref={liveViewRef}
            key={cam.id}
            cam={cam}
            onEnabledChange={reload}
            onStatusChange={setStatus}
            playback={selectedSegment ? { url: videoUrl, error: playbackError, label: formatDateTime(selectedSegment.started_at) } : null}
            onGoLive={goLive}
            onPlaybackEnded={handlePlaybackEnded}
            onPlaybackError={() => setPlaybackError(true)}
          />
        </Card>
      </div>

      {/* Right under the video, and always visible regardless of which tab is
          active — the whole point of living here instead of inside a
          tab-scoped panel is that it needs to be usable while actually
          watching or looking for something, not tucked behind a tab click. */}
      <Card>
        {selectedSegment && (
          <div className="flex items-center justify-between flex-wrap gap-2 mb-4 pb-4 border-b border-[#3A3A3A]">
            <div className="flex items-center gap-2">
              <p className="text-sm text-white font-medium">{formatDateTime(selectedSegment.started_at)}</p>
              {selectedSegment.locked && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(147,197,253,0.15)', color: '#93C5FD' }}>
                  Locked
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => prevRef.current?.()}
                disabled={!prevSegment}
                title="Previous recording"
                className="text-xs px-2.5 py-1 rounded transition-colors hover:opacity-80 disabled:opacity-30"
                style={{ background: '#3A3A3A', color: '#9CA3AF' }}
              >
                ‹ Prev
              </button>
              <button
                onClick={() => advanceRef.current?.()}
                disabled={!nextSegment}
                title="Next recording"
                className="text-xs px-2.5 py-1 rounded transition-colors hover:opacity-80 disabled:opacity-30"
                style={{ background: '#3A3A3A', color: '#9CA3AF' }}
              >
                Next ›
              </button>
              <button
                onClick={toggleLock}
                disabled={lockBusy}
                className="text-xs px-2.5 py-1 rounded transition-colors hover:opacity-80 disabled:opacity-40"
                style={{ background: '#3A3A3A', color: selectedSegment.locked ? '#93C5FD' : '#9CA3AF' }}
              >
                {selectedSegment.locked ? 'Unlock' : 'Lock'}
              </button>
              <button
                onClick={downloadSegment}
                disabled={!videoUrl}
                className="text-xs px-2.5 py-1 rounded transition-colors hover:opacity-80 disabled:opacity-40"
                style={{ background: '#3A3A3A', color: '#9CA3AF' }}
              >
                Download
              </button>
              <button
                onClick={deleteSegment}
                disabled={deleteBusy}
                className="text-xs px-2.5 py-1 rounded transition-colors hover:opacity-80 disabled:opacity-40"
                style={{ background: '#3A3A3A', color: '#EF4444' }}
              >
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}
        {actionError && <p className="text-xs text-red-400 mb-3">{actionError}</p>}

        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setDateStr(d => shiftDay(d, -1))}
              disabled={atOldest}
              className="px-2 py-1 rounded text-xs bg-[#3A3A3A] hover:bg-[#484848] text-white disabled:opacity-30 transition-colors"
            >‹ Prev</button>
            <span className="text-sm text-white font-medium min-w-[9rem] sm:min-w-[11rem] text-center">{formatDayLabel(dateStr)}</span>
            <button
              onClick={() => setDateStr(d => shiftDay(d, 1))}
              disabled={isToday}
              className="px-2 py-1 rounded text-xs bg-[#3A3A3A] hover:bg-[#484848] text-white disabled:opacity-30 transition-colors"
            >Next ›</button>
            {!isToday && (
              <button onClick={() => setDateStr(todayStr(tz))} className="text-xs text-gray-500 hover:text-gray-300">
                Jump to today
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <input
              type="datetime-local"
              value={gotoValue}
              onChange={e => setGotoValue(e.target.value)}
              className="bg-[#3A3A3A] border border-[#484848] rounded px-2 py-1 text-xs text-white focus:outline-none"
            />
            <button
              onClick={handleGoto}
              disabled={!gotoValue || gotoLoading}
              className="px-3 py-1 rounded text-xs font-medium disabled:opacity-40 transition-opacity hover:opacity-90"
              style={{ background: '#FFB800', color: '#151925' }}
            >
              {gotoLoading ? 'Looking…' : 'Go to date/time'}
            </button>
          </div>
        </div>
        {gotoError && <p className="text-xs text-red-400 mb-2">{gotoError}</p>}

        {dayError && <p className="text-xs text-red-400 mb-2">{dayError}</p>}

        {dayLoading ? (
          <div className="text-xs text-gray-600 py-8 text-center">Loading…</div>
        ) : segments.length === 0 ? (
          <div className="text-xs text-gray-600 py-8 text-center">
            No recordings for this day. {!summary?.segment_count && 'Enable continuous recording in Settings → Storage if you want them.'}
          </div>
        ) : (
          <div className="relative h-12 bg-[#111] rounded overflow-hidden select-none">
            {segmentsWithMinutes.map(seg => {
              const leftPct = (seg.startMin / 1440) * 100
              const widthPct = (SEGMENT_MINUTES / 1440) * 100
              const isSelected = selectedSegment?.id === seg.id
              return (
                <button
                  key={seg.id}
                  onClick={() => selectSegment(seg, { switchTab: true })}
                  title={formatDateTime(seg.started_at)}
                  className="absolute top-1 bottom-1 rounded-sm transition-colors"
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    minWidth: '4px',
                    background: isSelected ? '#FFB800' : seg.locked ? '#93C5FD' : '#4c6e5d',
                    outline: isSelected ? '2px solid #FFB800' : 'none',
                  }}
                />
              )
            })}
            {isToday && (
              <div
                className="absolute top-0 bottom-0 w-0.5 animate-pulse"
                style={{ left: `${(nowMinutes / 1440) * 100}%`, background: '#F87171' }}
                title="Now — the current segment isn't finalized yet"
              />
            )}
          </div>
        )}
        <div className="flex justify-between text-[10px] text-gray-600 mt-1 px-0.5">
          <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span>
        </div>
      </Card>

      <div className="flex items-center gap-1.5 border-b border-[#3A3A3A] overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setSearchParams(t.key === 'continuous' ? {} : { tab: t.key })}
            className="px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px shrink-0"
            style={tab === t.key
              ? { color: '#FFB800', borderColor: '#FFB800' }
              : { color: '#9CA3AF', borderColor: 'transparent' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'continuous' && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Retained footage</p>
                <p className="text-white font-medium">≈{approxDuration} · {summary?.segment_count ?? 0} segments</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Storage used</p>
                <p className="text-white font-medium">{formatBytes(summary?.total_bytes)}</p>
              </div>
              {summary?.oldest_started_at && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Oldest recording</p>
                  <p className="text-white font-medium">{formatDateTime(summary.oldest_started_at)}</p>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Locked Recordings</p>
            {lockedSegments.length === 0 ? (
              <p className="text-xs text-gray-600">
                No locked recordings. Lock a segment above to protect it from auto-purge and keep it here for easy access, regardless of which day it's from.
              </p>
            ) : (
              <div className="space-y-1">
                {lockedSegments.map(seg => {
                  const isSelected = selectedSegment?.id === seg.id
                  const isEditing = editingDescId === seg.id
                  return (
                    <div
                      key={seg.id}
                      className="w-full flex items-center gap-2 text-xs px-2 py-1.5 rounded transition-colors hover:bg-[#3A3A3A]"
                      style={isSelected ? { background: 'rgba(255,184,0,0.12)' } : {}}
                    >
                      <button
                        onClick={() => selectSegment(seg)}
                        className="flex-1 flex items-center gap-1.5 text-gray-300 text-left min-w-0"
                      >
                        <svg className="w-3 h-3 shrink-0" fill="none" stroke="#93C5FD" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 10-8 0v4h8z" />
                        </svg>
                        <div className="min-w-0">
                          <div>{formatDateTime(seg.started_at)}</div>
                          {!isEditing && seg.description && (
                            <div className="text-gray-500 truncate">{seg.description}</div>
                          )}
                        </div>
                      </button>
                      {isSelected && !isEditing && <span className="shrink-0" style={{ color: '#FFB800' }}>Playing</span>}
                      {!isEditing && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openReanalyze(seg) }}
                          className="shrink-0 p-1 rounded hover:bg-[#484848] text-gray-500 hover:text-gray-300 transition-colors"
                          title="Diagnose a missed detection in this recording"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
                          </svg>
                        </button>
                      )}
                      {!isEditing && (
                        <button
                          onClick={(e) => { e.stopPropagation(); startEditingDesc(seg) }}
                          className="shrink-0 p-1 rounded hover:bg-[#484848] text-gray-500 hover:text-gray-300 transition-colors"
                          title={seg.description ? 'Edit description' : 'Add description'}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      )}
                      {isEditing && (
                        <div className="flex-1 flex items-center gap-1.5 min-w-0" onClick={e => e.stopPropagation()}>
                          <input
                            autoFocus
                            value={descDraft}
                            onChange={e => setDescDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveDesc(seg.id); if (e.key === 'Escape') cancelEditingDesc() }}
                            maxLength={500}
                            placeholder="What's in this recording?"
                            className="flex-1 min-w-0 bg-[#1A1A1A] border border-[#484848] rounded px-2 py-1 text-xs text-white focus:outline-none"
                          />
                          <button
                            onClick={() => saveDesc(seg.id)}
                            disabled={savingDesc}
                            className="shrink-0 px-2 py-1 rounded text-xs font-medium disabled:opacity-40"
                            style={{ background: '#FFB800', color: '#151925' }}
                          >Save</button>
                          <button
                            onClick={cancelEditingDesc}
                            className="shrink-0 px-2 py-1 rounded text-xs text-gray-400 hover:text-gray-200"
                          >Cancel</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          {reanalyzeSeg && reanalyzeUrl && (
            <ReanalyzeModal segmentId={reanalyzeSeg.id} videoUrl={reanalyzeUrl} onClose={closeReanalyze} />
          )}
        </div>
      )}
      {tab === 'zones' && <ZoneEditor camId={cam.id} />}
      {tab === 'adjust' && <AdjustPanel camId={cam.id} />}
      {tab === 'face' && <FacePanel cam={cam} onUpdate={patch => setCam(prev => ({ ...prev, ...patch }))} />}
      {tab === 'history' && (
        <Card>
          <CameraDetections camId={cam.id} />
        </Card>
      )}
    </div>
  )
}
