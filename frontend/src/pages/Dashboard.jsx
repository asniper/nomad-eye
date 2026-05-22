import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { cameras, detections, notifications, settings as settingsApi } from '../api/client'
import { useDeviceStatus } from '../context/DeviceStatusContext'
import { formatDateTime, formatTime } from '../utils/dates'

const CATEGORY_STYLE = {
  people:   { background: 'rgba(239,68,68,0.15)',   color: '#F87171' },
  vehicles: { background: 'rgba(59,130,246,0.15)',  color: '#60A5FA' },
  animals:  { background: 'rgba(34,197,94,0.15)',   color: '#4ADE80' },
  faces:    { background: 'rgba(168,85,247,0.15)',  color: '#C084FC' },
  other:    { background: 'rgba(245,158,11,0.15)',  color: '#FCD34D' },
}
const STATUS_STYLE = {
  home:     { background: 'rgba(34,197,94,0.15)',   color: '#4ADE80' },
  away:     { background: 'rgba(245,158,11,0.15)',  color: '#FCD34D' },
  sleep:    { background: 'rgba(99,102,241,0.15)',  color: '#A78BFA' },
  vacation: { background: 'rgba(20,184,166,0.15)',  color: '#2DD4BF' },
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, v = bytes
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }
  return (
    <button onClick={copy} className="text-xs transition-colors shrink-0" style={{ color: copied ? '#4ADE80' : '#6B7280' }}>
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  )
}

function UrlRow({ label, url, isLink }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        {isLink ? (
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="text-sm font-mono truncate hover:text-white transition-colors"
            style={{ color: '#FFB800' }}>{url}</a>
        ) : (
          <span className="text-sm font-mono text-white bg-[#3A3A3A] px-2.5 py-1 rounded truncate">{url}</span>
        )}
        <CopyButton text={url} />
      </div>
    </div>
  )
}

function AccessCard({ externalUrl }) {
  const internalUrl = `http://${window.location.hostname}`
  return (
    <Card title="Access">
      <div className="space-y-3">
        <UrlRow label="Local Network" url={internalUrl} />
        {externalUrl ? (
          <UrlRow label="External / Remote" url={externalUrl} isLink />
        ) : (
          <div>
            <p className="text-xs text-gray-500 mb-1">External / Remote</p>
            <p className="text-xs text-gray-600">Not configured.</p>
            <Link to="/settings?tab=network" className="text-xs mt-0.5 block hover:text-white transition-colors" style={{ color: '#FFB800' }}>
              Add external URL in Settings →
            </Link>
          </div>
        )}
      </div>
    </Card>
  )
}

export default function Dashboard() {
  const { deviceStatus } = useDeviceStatus()
  const [cams, setCams] = useState([])
  const [cameraNames, setCameraNames] = useState({})
  const [recent, setRecent] = useState([])
  const [storage, setStorage] = useState(null)
  const [contacts, setContacts] = useState([])
  const [rules, setRules] = useState([])
  const [lastNotif, setLastNotif] = useState(null)
  const [externalUrl, setExternalUrl] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      cameras.list().then(r => {
        setCams(r.data)
        const names = {}
        r.data.forEach(c => { names[c.id] = c.name || `Camera ${c.id}` })
        setCameraNames(names)
      }).catch(() => {}),
      detections.list({ limit: 15 }).then(r => setRecent(r.data)).catch(() => {}),
      detections.storage().then(r => setStorage(r.data)).catch(() => {}),
      notifications.listContacts().then(r => setContacts(r.data)).catch(() => {}),
      notifications.listRules().then(r => setRules(r.data)).catch(() => {}),
      notifications.log({ limit: 1 }).then(r => setLastNotif(r.data[0] ?? null)).catch(() => {}),
      settingsApi.getAll().then(r => setExternalUrl(r.data?.external_url ?? '')).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>

  const onlineCams = cams.filter(c => c.alive).length
  const diskUsedPct = storage ? Math.min(100, Math.round((storage.disk_used / storage.disk_total) * 100)) : 0
  const activeContacts = contacts.filter(c => c.active).length
  const activeRules = rules.filter(r => r.active).length
  const byCategory = storage?.by_category ?? {}
  const totalDetections = storage?.total_detections ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold" style={{ color: '#FFB800' }}>Dashboard</h2>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize"
            style={STATUS_STYLE[deviceStatus] || { background: 'rgba(156,163,175,0.15)', color: '#9CA3AF' }}
          >{deviceStatus}</span>
          <Link to="/settings" className="text-xs hover:text-white transition-colors" style={{ color: '#FFB800' }}>Change</Link>
        </div>
      </div>

      {/* Primary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <p className="text-3xl font-bold text-white">{totalDetections.toLocaleString()}</p>
          <p className="text-sm text-gray-400 mt-1">Total Detections</p>
          <p className="text-xs text-gray-500 mt-1">across all cameras</p>
          <Link to="/detections" className="text-xs mt-2 block hover:text-white transition-colors" style={{ color: '#FFB800' }}>View all →</Link>
        </Card>

        <Card>
          <p className="text-3xl font-bold text-white">{onlineCams}<span className="text-lg text-gray-500"> / {cams.length}</span></p>
          <p className="text-sm text-gray-400 mt-1">Cameras Online</p>
          <p className="text-xs text-gray-500 mt-1">
            {cams.length === 0 ? 'No cameras' : onlineCams === cams.length ? 'All online' : `${cams.length - onlineCams} offline`}
          </p>
          <Link to="/cameras" className="text-xs mt-2 block hover:text-white transition-colors" style={{ color: '#FFB800' }}>Live feeds →</Link>
        </Card>

        <Card>
          <p className="text-3xl font-bold text-white">{formatBytes(storage?.image_bytes ?? 0)}</p>
          <p className="text-sm text-gray-400 mt-1">Images Stored</p>
          {storage ? (
            <>
              <div className="mt-2 h-1.5 rounded-full bg-[#3A3A3A] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${diskUsedPct}%`,
                    background: diskUsedPct > 85 ? '#F87171' : diskUsedPct > 65 ? '#FCD34D' : '#4ADE80',
                  }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">{diskUsedPct}% disk · {formatBytes(storage.disk_free)} free</p>
            </>
          ) : (
            <p className="text-xs text-gray-500 mt-1">—</p>
          )}
          <Link to="/settings" className="text-xs mt-2 block hover:text-white transition-colors" style={{ color: '#FFB800' }}>Manage storage →</Link>
        </Card>

        <Card>
          <p className="text-3xl font-bold text-white">{activeRules}</p>
          <p className="text-sm text-gray-400 mt-1">Active Rules</p>
          <p className="text-xs text-gray-500 mt-1">{activeContacts} active contact{activeContacts !== 1 ? 's' : ''}</p>
          {lastNotif ? (
            <p className="text-xs text-gray-600 mt-1">Last sent {formatTime(lastNotif.timestamp)}</p>
          ) : (
            <p className="text-xs text-gray-600 mt-1">No notifications yet</p>
          )}
          <Link to="/notifications" className="text-xs mt-2 block hover:text-white transition-colors" style={{ color: '#FFB800' }}>Manage →</Link>
        </Card>
      </div>

      {/* Detection category breakdown */}
      {Object.keys(byCategory).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {['people', 'vehicles', 'animals', 'faces', 'other'].map(cat => (
            <Card key={cat}>
              <p className="text-2xl font-bold" style={{ color: CATEGORY_STYLE[cat].color }}>
                {(byCategory[cat] ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-1 capitalize">{cat}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent detections */}
        <Card title="Recent Detections">
          {recent.length === 0 && <p className="text-gray-500 text-sm">No detections yet.</p>}
          {recent.map(d => (
            <div key={d.id} className="flex items-start gap-2.5 py-2.5 border-b border-[#3A3A3A] last:border-0">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize shrink-0 mt-0.5"
                style={CATEGORY_STYLE[d.category] || CATEGORY_STYLE.other}
              >{d.category}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-gray-100 capitalize">{d.label}</span>
                  <span className="text-xs text-gray-500 shrink-0">{Math.round(d.confidence * 100)}%</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-xs text-gray-500">{cameraNames[d.camera_id] || `Cam ${d.camera_id}`}</span>
                  <span className="text-gray-600 text-xs">·</span>
                  <span className="text-xs text-gray-500">{formatDateTime(d.timestamp)}</span>
                </div>
              </div>
            </div>
          ))}
          <Link to="/detections" className="text-xs mt-3 block hover:text-white transition-colors" style={{ color: '#FFB800' }}>View all detections →</Link>
        </Card>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          <Card title="Camera Status">
            {cams.length === 0 && <p className="text-gray-500 text-sm">No cameras detected.</p>}
            {cams.map(cam => (
              <div key={cam.id} className="flex items-center justify-between py-2.5 border-b border-[#3A3A3A] last:border-0">
                <div>
                  <span className="text-sm font-medium text-white">{cam.name || `Camera ${cam.id}`}</span>
                  {cam.device && <p className="text-xs text-gray-600 font-mono mt-0.5">{cam.device}</p>}
                </div>
                <Badge label={cam.alive ? 'Online' : 'Offline'} color={cam.alive ? 'green' : 'red'} />
              </div>
            ))}
            <Link to="/cameras" className="text-xs mt-3 block hover:text-white transition-colors" style={{ color: '#FFB800' }}>View live feeds →</Link>
          </Card>

          <Card title="Notifications">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Contacts</span>
                <span className="text-sm text-white">{activeContacts} active <span className="text-gray-600">/ {contacts.length}</span></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Rules</span>
                <span className="text-sm text-white">{activeRules} active <span className="text-gray-600">/ {rules.length}</span></span>
              </div>
              {lastNotif ? (
                <div className="pt-2.5 border-t border-[#3A3A3A]">
                  <p className="text-xs text-gray-500 mb-1.5">Last notification sent</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge label={lastNotif.channel} color={lastNotif.channel === 'sms' ? 'green' : 'blue'} />
                    <span className="text-xs text-gray-300">{lastNotif.contact_name}</span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-full"
                      style={lastNotif.status === 'sent'
                        ? { background: 'rgba(34,197,94,0.15)', color: '#4ADE80' }
                        : { background: 'rgba(239,68,68,0.15)', color: '#F87171' }}
                    >{lastNotif.status}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{formatDateTime(lastNotif.timestamp)}</p>
                </div>
              ) : (
                <p className="text-xs text-gray-600 pt-1">No notifications sent yet.</p>
              )}
            </div>
            <Link to="/notifications" className="text-xs mt-3 block hover:text-white transition-colors" style={{ color: '#FFB800' }}>Manage notifications →</Link>
          </Card>

          <AccessCard externalUrl={externalUrl} />
        </div>
      </div>
    </div>
  )
}
