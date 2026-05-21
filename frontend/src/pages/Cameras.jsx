import { useEffect, useRef, useState, useCallback } from 'react'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { cameras } from '../api/client'

function CameraFeed({ cam }) {
  const imgRef = useRef(null)
  const wsRef = useRef(null)
  const [overlay, setOverlay] = useState(true)
  const [connected, setConnected] = useState(false)
  const [fps, setFps] = useState(0)
  const fpsCountRef = useRef(0)

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/api/cameras/${cam.id}/stream`)
    wsRef.current = ws
    ws.binaryType = 'blob'

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)

    ws.onmessage = (e) => {
      const url = URL.createObjectURL(e.data)
      if (imgRef.current) {
        const old = imgRef.current.src
        imgRef.current.src = url
        if (old.startsWith('blob:')) URL.revokeObjectURL(old)
      }
      fpsCountRef.current++
    }

    const fpsTimer = setInterval(() => {
      setFps(fpsCountRef.current)
      fpsCountRef.current = 0
    }, 1000)

    return () => {
      ws.close()
      clearInterval(fpsTimer)
    }
  }, [cam.id])

  const handleOverlayToggle = () => {
    const next = !overlay
    setOverlay(next)
    cameras.toggleOverlay(cam.id, next)
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white">Camera {cam.id}</span>
          <Badge label={connected ? 'Live' : 'Offline'} color={connected ? 'green' : 'red'} />
          {connected && <span className="text-xs text-gray-500">{fps} fps</span>}
          {cam.device && <span className="text-xs text-gray-600 font-mono">{cam.device}</span>}
        </div>
        <button
          onClick={handleOverlayToggle}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            overlay ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          {overlay ? 'Overlay On' : 'Overlay Off'}
        </button>
      </div>
      <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
        {!connected && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
            Connecting...
          </div>
        )}
        <img
          ref={imgRef}
          alt={`Camera ${cam.id}`}
          className="w-full h-full object-contain"
        />
      </div>
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

  useEffect(() => {
    loadCameras().finally(() => setLoading(false))
  }, [loadCameras])

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

  if (loading) return <div className="text-gray-500 text-sm">Loading cameras...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Cameras</h2>
        <button
          onClick={handleDetect}
          disabled={detecting}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg
            className={`w-4 h-4 ${detecting ? 'animate-spin' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {detecting ? 'Scanning...' : 'Detect Cameras'}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          {error}
        </p>
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
        {cams.map(cam => <CameraFeed key={cam.id} cam={cam} />)}
      </div>
    </div>
  )
}
