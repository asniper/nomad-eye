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

function Screenshot({ id, isBest, index, onClick }) {
  const src = useBlob(id)
  return (
    <div className="relative group cursor-pointer" onClick={() => src && onClick(index)}>
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

function Lightbox({ ids, initialIndex, onClose }) {
  const [index, setIndex] = useState(initialIndex)
  const [src, setSrc] = useState(null)
  const urlRef = useRef(null)
  const touchStartX = useRef(null)

  useEffect(() => {
    let active = true
    setSrc(null)
    detections.image(ids[index]).then(r => {
      if (!active) return
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      const url = URL.createObjectURL(r.data)
      urlRef.current = url
      setSrc(url)
    }).catch(() => {})
    return () => { active = false }
  }, [index, ids])

  useEffect(() => {
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }
  }, [])

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setIndex(i => Math.min(ids.length - 1, i + 1))
    }
    window.addEventListener('keydown', h)
    // Escape does nothing on a touchscreen — without a real close button, the
    // only way to dismiss on mobile is tapping the thin backdrop margin around
    // a near-fullscreen image. Lock background scroll too so a stray drag on
    // that backdrop doesn't scroll the page underneath instead of doing nothing.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', h)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose, ids.length])

  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX }
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (dx > 50) setIndex(i => Math.max(0, i - 1))
    else if (dx < -50) setIndex(i => Math.min(ids.length - 1, i + 1))
    touchStartX.current = null
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {ids.length > 1 && index > 0 && (
        <button
          onClick={e => { e.stopPropagation(); setIndex(i => i - 1) }}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white text-2xl bg-black/50 hover:bg-black/80 rounded-full w-10 h-10 flex items-center justify-center z-10 transition-colors"
        >‹</button>
      )}
      <div onClick={e => e.stopPropagation()} className="flex items-center justify-center max-w-full max-h-full">
        {!src
          ? <div className="w-64 h-48 bg-[#3A3A3A] rounded-lg animate-pulse" />
          : <img src={src} alt="full size" className="max-w-full max-h-[90vh] rounded-lg" />
        }
      </div>
      {ids.length > 1 && index < ids.length - 1 && (
        <button
          onClick={e => { e.stopPropagation(); setIndex(i => i + 1) }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-white text-2xl bg-black/50 hover:bg-black/80 rounded-full w-10 h-10 flex items-center justify-center z-10 transition-colors"
        >›</button>
      )}
      {ids.length > 1 && (
        <div className="absolute bottom-4 text-xs text-gray-400 bg-black/40 px-2 py-1 rounded">
          {index + 1} / {ids.length}
        </div>
      )}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors z-10"
        title="Close"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function ClipSection({ eventId, onDeleted }) {
  const [src, setSrc] = useState(null)
  const [clipError, setClipError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deletingClip, setDeletingClip] = useState(false)
  const urlRef = useRef(null)

  useEffect(() => {
    let active = true
    detections.clip(eventId)
      .then(r => {
        if (!active) return
        const url = URL.createObjectURL(r.data)
        urlRef.current = url
        setSrc(url)
      })
      .catch(() => { if (active) setClipError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => {
      active = false
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [eventId])

  const handleDownload = () => {
    if (!src) return
    const a = document.createElement('a')
    a.href = src
    a.download = `clip-${eventId}.mp4`
    a.click()
  }

  const handleDelete = () => {
    if (!window.confirm('Delete the video clip for this event?')) return
    setDeletingClip(true)
    detections.deleteClip(eventId)
      .then(() => {
        if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
        onDeleted()
      })
      .catch(() => setDeletingClip(false))
  }

  if (clipError) return (
    <Card>
      <p className="text-sm text-gray-400 font-medium mb-2">Video Clip</p>
      <p className="text-sm text-red-400">Clip not available.</p>
    </Card>
  )

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-400 font-medium">Video Clip</p>
        <div className="flex gap-2">
          {src && (
            <button
              onClick={handleDownload}
              className="text-xs px-2.5 py-1 rounded transition-colors hover:opacity-80"
              style={{ background: '#3A3A3A', color: '#9CA3AF' }}
            >
              Download
            </button>
          )}
          <button
            disabled={deletingClip}
            onClick={handleDelete}
            className="text-xs px-2.5 py-1 rounded transition-colors hover:opacity-80 disabled:opacity-40"
            style={{ background: '#3A3A3A', color: '#EF4444' }}
          >
            {deletingClip ? 'Deleting…' : 'Delete Clip'}
          </button>
        </div>
      </div>
      {loading ? (
        <div className="w-full aspect-video bg-[#3A3A3A] rounded-lg animate-pulse" />
      ) : (
        <video
          src={src}
          controls
          autoPlay
          playsInline
          className="w-full rounded-lg"
          style={{ background: '#000' }}
        />
      )}
    </Card>
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
  const [hasClip, setHasClip] = useState(false)

  useEffect(() => {
    detections.event(eventId)
      .then(r => {
        setEvent(r.data)
        setHasClip(r.data.has_clip === 1)
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
      {lightbox !== null && (
        <Lightbox ids={ids} initialIndex={lightbox} onClose={() => setLightbox(null)} />
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/detections" className="text-sm hover:underline" style={{ color: '#FFB800' }}>← Detections</Link>
        <h2 className="text-2xl font-bold text-white capitalize">{event.label} Event</h2>
        <div className="ml-auto">
          <button
            disabled={deleting}
            onClick={() => {
              if (!window.confirm('Delete this event and all its images?')) return
              setDeleting(true)
              detections.deleteEvent(eventId)
                .then(() => navigate('/detections'))
                .catch(() => setDeleting(false))
            }}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-900/40 text-red-400 hover:bg-red-900/60 disabled:opacity-40 transition-colors"
          >
            {deleting ? 'Deleting…' : 'Delete Event'}
          </button>
        </div>
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

      {hasClip && <ClipSection eventId={eventId} onDeleted={() => setHasClip(false)} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {ids.map((id, i) => (
          <Screenshot key={id} id={id} isBest={i === 0} index={i} onClick={setLightbox} />
        ))}
      </div>

      {ids.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-8">No screenshots available for this event.</p>
      )}
    </div>
  )
}
