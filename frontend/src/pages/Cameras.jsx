import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card'
import Badge from '../components/Badge'
import CameraLiveView, { statusBadge } from '../components/CameraLiveView'
import { cameras } from '../api/client'

const TAB_LINK = "px-2.5 py-1 rounded text-xs font-medium transition-colors bg-[#3A3A3A] text-gray-300 hover:bg-[#484848] no-underline"

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
  const [name, setName] = useState(cam.name || '')
  const [editingName, setEditingName] = useState(false)
  const [status, setStatus] = useState({ connected: false, reloading: false, fps: 0 })

  const saveName = async () => {
    setEditingName(false)
    const trimmed = name.trim()
    if (trimmed !== cam.name) {
      await cameras.setName(cam.id, trimmed).catch(() => {})
      onNameSaved(cam.id, trimmed)
    }
  }

  const displayName = cam.name || `Camera ${cam.id}`
  const badge = statusBadge(status)

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
            <Badge label={badge.label} color={badge.color} />
            {status.connected && !status.reloading && <span className="text-xs text-gray-500">{status.fps} fps</span>}
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
      </div>

      <CameraLiveView cam={cam} onEnabledChange={onEnabledChange} onStatusChange={setStatus}>
        <Link to={`/cameras/${cam.id}`} className={TAB_LINK} style={{ background: '#FFB800', color: '#151925' }}
          title="Continuous recording, zones, adjustments, face settings, and detection history for this camera">
          Edit Camera
        </Link>
      </CameraLiveView>
    </Card>
  )
}

export default function Cameras() {
  const [cams, setCams] = useState([])
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState(null)

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
