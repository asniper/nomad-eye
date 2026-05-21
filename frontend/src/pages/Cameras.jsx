import { useEffect, useRef, useState } from 'react'
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
  const [error, setError] = useState(null)

  useEffect(() => {
    cameras.list()
      .then(r => setCams(r.data))
      .catch(() => setError('Could not load cameras. Make sure the detection pipeline is running.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-500 text-sm">Loading cameras...</div>

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Cameras</h2>
      {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</p>}
      {!error && cams.length === 0 && (
        <p className="text-gray-500 text-sm">No cameras found. Connect cameras and restart the detection pipeline.</p>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {cams.map(cam => <CameraFeed key={cam.id} cam={cam} />)}
      </div>
    </div>
  )
}
