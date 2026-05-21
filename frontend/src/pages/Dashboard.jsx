import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { cameras, detections, network, status } from '../api/client'

const CATEGORY_COLOR = { people: 'blue', vehicles: 'yellow', animals: 'green', other: 'gray' }
const STATUS_COLOR = { home: 'green', away: 'yellow', sleep: 'blue', vacation: 'red' }

export default function Dashboard() {
  const [cams, setCams] = useState([])
  const [recent, setRecent] = useState([])
  const [netStatus, setNetStatus] = useState(null)
  const [deviceStatus, setDeviceStatus] = useState('home')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      cameras.list().then(r => setCams(r.data)).catch(() => {}),
      detections.list({ limit: 10 }).then(r => setRecent(r.data)).catch(() => {}),
      network.status().then(r => setNetStatus(r.data)).catch(() => {}),
      status.get().then(r => setDeviceStatus(r.data.status)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <Badge label={deviceStatus.toUpperCase()} color={STATUS_COLOR[deviceStatus] || 'gray'} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <p className="text-3xl font-bold text-white">{cams.length}</p>
          <p className="text-sm text-gray-400 mt-1">Cameras</p>
          <p className="text-xs text-gray-500 mt-1">{cams.filter(c => c.alive).length} online</p>
        </Card>
        <Card>
          <p className="text-3xl font-bold text-white">{recent.length}</p>
          <p className="text-sm text-gray-400 mt-1">Recent Detections</p>
          <p className="text-xs text-gray-500 mt-1">Last 10 events</p>
        </Card>
        <Card>
          <p className="text-3xl font-bold text-white">{netStatus?.connected ? 'Online' : 'Offline'}</p>
          <p className="text-sm text-gray-400 mt-1">Network</p>
          <p className="text-xs text-gray-500 mt-1">{netStatus?.ip || '—'}</p>
        </Card>
        <Card>
          <p className="text-3xl font-bold text-white capitalize">{deviceStatus}</p>
          <p className="text-sm text-gray-400 mt-1">Status</p>
          <Link to="/settings" className="text-xs text-blue-400 hover:text-blue-300 mt-1 block">Change</Link>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Cameras">
          {cams.length === 0 && <p className="text-gray-500 text-sm">No cameras detected.</p>}
          {cams.map(cam => (
            <div key={cam.id} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
              <span className="text-sm font-medium">Camera {cam.id}</span>
              <Badge label={cam.alive ? 'Online' : 'Offline'} color={cam.alive ? 'green' : 'red'} />
            </div>
          ))}
          <Link to="/cameras" className="text-xs text-blue-400 hover:text-blue-300 mt-3 block">View live feeds →</Link>
        </Card>

        <Card title="Recent Detections">
          {recent.length === 0 && <p className="text-gray-500 text-sm">No detections yet.</p>}
          {recent.map(d => (
            <div key={d.id} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Badge label={d.category} color={CATEGORY_COLOR[d.category] || 'gray'} />
                <span className="text-sm text-gray-200 capitalize truncate">{d.label}</span>
                <span className="text-xs text-gray-500">Cam {d.camera_id}</span>
              </div>
              <span className="text-xs text-gray-500 shrink-0">{new Date(d.timestamp).toLocaleTimeString()}</span>
            </div>
          ))}
          <Link to="/detections" className="text-xs text-blue-400 hover:text-blue-300 mt-3 block">View all detections →</Link>
        </Card>
      </div>
    </div>
  )
}
