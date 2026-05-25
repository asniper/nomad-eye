import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card'
import { detections, cameras } from '../api/client'
import { formatDateTime, formatTime } from '../utils/dates'

const CATEGORY_STYLE = {
  people:   { background: 'rgba(239,68,68,0.15)',   color: '#F87171' },
  vehicles: { background: 'rgba(59,130,246,0.15)',  color: '#60A5FA' },
  animals:  { background: 'rgba(34,197,94,0.15)',   color: '#4ADE80' },
  faces:    { background: 'rgba(168,85,247,0.15)',  color: '#C084FC' },
  other:    { background: 'rgba(245,158,11,0.15)',  color: '#FCD34D' },
}
const CATEGORIES = ['all', 'people', 'faces', 'vehicles', 'animals', 'other']
const PAGE_SIZE = 20

function useBlobUrl(detectionId) {
  const [src, setSrc] = useState(null)
  const urlRef = useRef(null)
  useEffect(() => {
    if (!detectionId) return
    let active = true
    detections.image(detectionId)
      .then(r => {
        if (!active) return
        const url = URL.createObjectURL(r.data)
        urlRef.current = url
        setSrc(url)
      })
      .catch(() => {})
    return () => {
      active = false
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [detectionId])
  return src
}

function Thumb({ id, onClick }) {
  const src = useBlobUrl(id)
  if (!src) return <div className="w-20 h-14 bg-[#3A3A3A] rounded shrink-0 animate-pulse" />
  return (
    <img
      src={src}
      alt="screenshot"
      onClick={() => onClick(src)}
      className="w-20 h-14 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity bg-[#3A3A3A] shrink-0"
    />
  )
}

function Lightbox({ src, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={onClose}>
      <img src={src} alt="detection" className="max-w-full max-h-full rounded-lg" onClick={e => e.stopPropagation()} />
    </div>
  )
}

function EventRow({ ev, cameraNames, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const ids = ev.detection_ids || []
  const previewIds = ids.slice(0, 4)
  const hasMore = ids.length > 4

  const durationMs = ev.last_seen && ev.first_seen
    ? new Date(ev.last_seen) - new Date(ev.first_seen)
    : 0
  const durationLabel = durationMs < 1000
    ? null
    : durationMs < 60000
      ? `${Math.round(durationMs / 1000)}s`
      : `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`

  return (
    <>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      <div className="py-3 border-b border-[#3A3A3A] last:border-0">
        <div className="flex flex-col sm:flex-row items-start gap-2 sm:gap-3">
          {/* Thumbnail strip */}
          <div className="flex gap-1 flex-wrap shrink-0">
            {previewIds.map(id => (
              <Thumb key={id} id={id} onClick={setLightbox} />
            ))}
            {hasMore && !expanded && (
              <button
                onClick={() => setExpanded(true)}
                className="w-20 h-14 bg-[#3A3A3A] rounded shrink-0 text-xs text-gray-400 hover:bg-[#484848] transition-colors flex items-center justify-center"
              >
                +{ids.length - 4} more
              </button>
            )}
          </div>

          {/* Meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                style={CATEGORY_STYLE[ev.category] || CATEGORY_STYLE.other}
              >{ev.category}</span>
              <span className="text-sm font-medium text-white capitalize">{ev.label}</span>
              <span className="text-xs text-gray-500">{cameraNames[ev.camera_id] || `Cam ${ev.camera_id}`}</span>
              <span className="text-xs text-gray-600">{ids.length} screenshot{ids.length !== 1 ? 's' : ''}</span>
              {durationLabel && <span className="text-xs text-gray-600">{durationLabel}</span>}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <p className="text-xs text-gray-500">{formatDateTime(ev.first_seen)}</p>
              <Link to={`/events/${ev.event_id}`} className="text-xs font-medium hover:underline" style={{ color: '#FFB800' }}>
                View event →
              </Link>
              <button
                disabled={deleting}
                onClick={() => {
                  if (!window.confirm('Delete this event and all its images?')) return
                  setDeleting(true)
                  detections.deleteEvent(ev.event_id)
                    .then(() => onDelete(ev.event_id))
                    .catch(() => setDeleting(false))
                }}
                className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>

        {/* Expanded gallery */}
        {expanded && (
          <div className="mt-2 flex flex-wrap gap-1">
            {ids.slice(4).map(id => (
              <Thumb key={id} id={id} onClick={setLightbox} />
            ))}
            <button
              onClick={() => setExpanded(false)}
              className="w-20 h-14 bg-[#3A3A3A] rounded shrink-0 text-xs text-gray-400 hover:bg-[#484848] transition-colors flex items-center justify-center"
            >
              Show less
            </button>
          </div>
        )}
      </div>
    </>
  )
}

export default function Detections() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [cameraNames, setCameraNames] = useState({})
  const [category, setCategory] = useState('all')
  const [camFilter, setCamFilter] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const load = useCallback((p) => {
    setLoading(true)
    const params = { limit: PAGE_SIZE, offset: (p - 1) * PAGE_SIZE }
    if (category !== 'all') params.category = category
    if (camFilter) params.camera_id = parseInt(camFilter)
    if (labelFilter) params.label = labelFilter
    detections.events(params)
      .then(r => { setEvents(r.data.events); setTotal(r.data.total) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [category, camFilter, labelFilter])

  useEffect(() => { load(page) }, [load, page])

  useEffect(() => {
    cameras.list().then(r => {
      const names = {}
      r.data.forEach(c => { names[c.id] = c.name || `Camera ${c.id}` })
      setCameraNames(names)
    }).catch(() => {})
  }, [])

  const changeFilter = (setter) => (val) => { setter(val); setPage(1) }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold" style={{ color: '#FFB800' }}>Detection Events</h2>

      <Card>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Category</label>
            <div className="flex gap-1 flex-wrap">
              {CATEGORIES.map(c => {
                const active = category === c
                const style = CATEGORY_STYLE[c]
                return (
                  <button
                    key={c}
                    onClick={() => changeFilter(setCategory)(c)}
                    className="px-3 py-1 rounded-md text-xs font-medium transition-opacity capitalize hover:opacity-80"
                    style={active
                      ? { background: style?.color ?? '#FFB800', color: '#151925' }
                      : { background: style ? style.background : '#3A3A3A', color: style?.color ?? '#9CA3AF', border: style ? `1px solid ${style.color}33` : '1px solid transparent' }
                    }
                  >
                    {c}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Camera</label>
            <select
              value={camFilter}
              onChange={e => changeFilter(setCamFilter)(e.target.value)}
              className="bg-[#3A3A3A] border border-[#484848] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none transition-colors"
              onFocus={e => e.target.style.borderColor = '#4c6e5d'}
              onBlur={e => e.target.style.borderColor = '#484848'}>
              <option value="">All cameras</option>
              {Object.entries(cameraNames).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Label</label>
            <input
              type="text"
              value={labelFilter}
              onChange={e => changeFilter(setLabelFilter)(e.target.value)}
              placeholder="Filter by label..."
              className="bg-[#3A3A3A] border border-[#484848] rounded-md px-3 py-1.5 text-sm text-white w-40 focus:outline-none transition-colors"
              onFocus={e => e.target.style.borderColor = '#4c6e5d'}
              onBlur={e => e.target.style.borderColor = '#484848'}
            />
          </div>
        </div>
      </Card>

      <Card>
        {loading && <p className="text-gray-500 text-sm py-4 text-center">Loading...</p>}
        {!loading && events.length === 0 && (
          <p className="text-gray-500 text-sm py-4 text-center">No detection events found.</p>
        )}
        {events.map(ev => (
          <EventRow
            key={ev.event_id}
            ev={ev}
            cameraNames={cameraNames}
            onDelete={(id) => setEvents(prev => prev.filter(e => e.event_id !== id))}
          />
        ))}

        {!loading && totalPages > 0 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-[#3A3A3A]">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded-md text-xs bg-[#3A3A3A] text-gray-300 hover:bg-[#484848] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 2)
                .reduce((acc, n, idx, arr) => {
                  if (idx > 0 && n - arr[idx - 1] > 1) acc.push('…')
                  acc.push(n)
                  return acc
                }, [])
                .map((n, idx) => n === '…' ? (
                  <span key={`ellipsis-${idx}`} className="text-xs text-gray-600 px-1">…</span>
                ) : (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className="w-7 h-7 rounded text-xs font-medium transition-colors"
                    style={n === page
                      ? { background: '#FFB800', color: '#151925' }
                      : { background: '#3A3A3A', color: '#9CA3AF' }
                    }
                  >
                    {n}
                  </button>
                ))}
            </div>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded-md text-xs bg-[#3A3A3A] text-gray-300 hover:bg-[#484848] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
