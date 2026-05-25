import { useEffect, useState, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import Card from '../components/Card'
import { detections, cameras } from '../api/client'
import { formatDateTime } from '../utils/dates'

const CATEGORY_STYLE = {
  people:   { background: 'rgba(239,68,68,0.15)',   color: '#F87171' },
  vehicles: { background: 'rgba(59,130,246,0.15)',  color: '#60A5FA' },
  animals:  { background: 'rgba(34,197,94,0.15)',   color: '#4ADE80' },
  other:    { background: 'rgba(245,158,11,0.15)',  color: '#FCD34D' },
}

function useBlob(id) {
  const [src, setSrc] = useState(null)
  const urlRef = useRef(null)
  useEffect(() => {
    if (!id) return
    let active = true
    detections.image(id).then(r => {
      if (!active) return
      const url = URL.createObjectURL(r.data)
      urlRef.current = url
      setSrc(url)
    }).catch(() => {})
    return () => { active = false; if (urlRef.current) URL.revokeObjectURL(urlRef.current) }
  }, [id])
  return src
}

function Screenshot({ id, isBest, onClick }) {
  const src = useBlob(id)
  return (
    <div className="relative group cursor-pointer" onClick={() => src && onClick(src)}>
      {!src
        ? <div className="w-full aspect-video bg-[#3A3A3A] rounded-lg animate-pulse" />
        : <img src={src} alt="screenshot" className="w-full aspect-video object-cover rounded-lg hover:opacity-90 transition-opacity" />
      }
      {isBest && (
        <span className="absolute top-1.5 left-1.5 text-xs font-medium px-1.5 py-0.5 rounded" style={{ background: '#FFB800', color: '#151925' }}>
          Best
        </span>
      )}
    </div>
  )
}

function Lightbox({ src, onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={onClose}>
      <img src={src} alt="full size" className="max-w-full max-h-full rounded-lg" onClick={e => e.stopPropagation()} />
    </div>
  )
}

export default function EventDetail() {
  const { eventId } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState(null)
  const [cameraName, setCameraName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState(null)
  const [error, setError] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    detections.event(eventId)
      .then(r => {
        setEvent(r.data)
        return cameras.list().then(cr => {
          const cam = cr.data.find(c => c.id === r.data.camera_id)
          setCameraName(cam?.name || `Camera ${r.data.camera_id}`)
        }).catch(() => setCameraName(`Camera ${r.data.camera_id}`))
      })
      .catch(() => setError('Event not found.'))
      .finally(() => setLoading(false))
  }, [eventId])

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>
  if (error || !event) return (
    <div className="space-y-4">
      <Link to="/detections" className="text-sm hover:underline" style={{ color: '#FFB800' }}>← Back to Detections</Link>
      <p className="text-red-400 text-sm">{error || 'Event not found.'}</p>
    </div>
  )

  const durationMs = event.last_seen && event.first_seen
    ? new Date(event.last_seen) - new Date(event.first_seen) : 0
  const durationLabel = durationMs < 1000 ? null
    : durationMs < 60000 ? `${Math.round(durationMs / 1000)}s`
    : `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`

  const ids = event.detection_ids || []

  return (
    <div className="space-y-6">
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}

      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/detections" className="text-sm hover:underline" style={{ color: '#FFB800' }}>← Detections</Link>
        <h2 className="text-2xl font-bold text-white capitalize">{event.label} Event</h2>
        <button
          disabled={deleting}
          onClick={() => {
            if (!window.confirm('Delete this event and all its images?')) return
            setDeleting(true)
            detections.deleteEvent(eventId)
              .then(() => navigate('/detections'))
              .catch(() => setDeleting(false))
          }}
          className="ml-auto px-3 py-1.5 rounded-md text-xs font-medium bg-red-900/40 text-red-400 hover:bg-red-900/60 disabled:opacity-40 transition-colors"
        >
          {deleting ? 'Deleting…' : 'Delete Event'}
        </button>
      </div>

      <Card>
        <div className="flex flex-wrap gap-3 items-center">
          <span
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize"
            style={CATEGORY_STYLE[event.category] || CATEGORY_STYLE.other}
          >{event.category}</span>
          <span className="text-sm font-medium text-white capitalize">{event.label}</span>
          <span className="text-xs text-gray-400">{cameraName}</span>
          {durationLabel && <span className="text-xs text-gray-500">Duration: {durationLabel}</span>}
          <span className="text-xs text-gray-500">{ids.length} screenshot{ids.length !== 1 ? 's' : ''}</span>
        </div>
        <p className="text-xs text-gray-500 mt-2">{formatDateTime(event.first_seen)}</p>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {ids.map((id, i) => (
          <Screenshot key={id} id={id} isBest={i === 0} onClick={setLightbox} />
        ))}
      </div>

      {ids.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-8">No screenshots available for this event.</p>
      )}
    </div>
  )
}
