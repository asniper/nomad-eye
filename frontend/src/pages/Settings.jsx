import { useEffect, useState, useCallback } from 'react'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { settings, detections as detectionsApi, storage as storageApi, system as systemApi, cameras as camerasApi } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import { useDeviceStatus } from '../context/DeviceStatusContext'
import { setTimezone } from '../utils/dates'
import Network from './Network'

const TIMEZONES = [
  { label: 'Eastern (ET)', value: 'America/New_York' },
  { label: 'Central (CT)', value: 'America/Chicago' },
  { label: 'Mountain (MT)', value: 'America/Denver' },
  { label: 'Mountain – Arizona (no DST)', value: 'America/Phoenix' },
  { label: 'Pacific (PT)', value: 'America/Los_Angeles' },
  { label: 'Alaska (AKT)', value: 'America/Anchorage' },
  { label: 'Hawaii (HT)', value: 'Pacific/Honolulu' },
  { label: 'UTC', value: 'UTC' },
  { label: 'London (GMT/BST)', value: 'Europe/London' },
  { label: 'Paris / Berlin (CET/CEST)', value: 'Europe/Paris' },
  { label: 'Moscow (MSK)', value: 'Europe/Moscow' },
  { label: 'Dubai (GST)', value: 'Asia/Dubai' },
  { label: 'India (IST)', value: 'Asia/Kolkata' },
  { label: 'China / Singapore', value: 'Asia/Shanghai' },
  { label: 'Japan (JST)', value: 'Asia/Tokyo' },
  { label: 'Sydney (AEST/AEDT)', value: 'Australia/Sydney' },
  { label: 'Auckland (NZST/NZDT)', value: 'Pacific/Auckland' },
]

const STATUS_OPTIONS = ['home', 'away', 'sleep', 'vacation']
const STATUS_COLOR = { home: 'green', away: 'yellow', sleep: 'blue', vacation: 'red' }

const inputCls = "bg-[#3A3A3A] border border-[#484848] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none transition-colors"

function SettingRow({ label, hint, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6 py-4 border-b border-[#3A3A3A] last:border-0">
      <div className="sm:w-48 shrink-0">
        <p className="text-sm font-medium text-white">{label}</p>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'network', label: 'Network' },
  { id: 'storage', label: 'Storage & System' },
]

export default function Settings() {
  const { logout } = useAuth()
  const { deviceStatus, updateStatus } = useDeviceStatus()
  const [allSettings, setAllSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [saved, setSaved] = useState({})
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'general')

  const changeTab = useCallback((id) => {
    setTab(id)
    const url = new URL(window.location)
    url.searchParams.set('tab', id)
    window.history.pushState({}, '', url)
  }, [])

  useEffect(() => {
    settings.getAll().then(r => {
      const s = r.data || {}
      setAllSettings(s)
      if (s.timezone) setTimezone(s.timezone)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const saveSetting = async (key, value) => {
    setSaving(s => ({ ...s, [key]: true }))
    try {
      await settings.set(key, value)
      setAllSettings(s => ({ ...s, [key]: value }))
      if (key === 'timezone') setTimezone(value)
      setSaved(s => ({ ...s, [key]: true }))
      setTimeout(() => setSaved(s => ({ ...s, [key]: false })), 2000)
    } catch {}
    setSaving(s => ({ ...s, [key]: false }))
  }

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-6 flex-wrap">
        <h2 className="text-2xl font-bold" style={{ color: '#FFB800' }}>Settings</h2>
        <div className="flex gap-1 border-b border-[#3A3A3A] pb-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => changeTab(t.id)}
              className="px-4 py-1.5 text-sm font-medium transition-colors rounded-t-md"
              style={tab === t.id
                ? { color: '#FFB800', borderBottom: '2px solid #FFB800', marginBottom: '-1px' }
                : { color: '#9CA3AF' }
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'network' && <Network />}
      {tab === 'storage' && <StorageTab />}

      {tab === 'general' && <>

      <Card title="Device Status">
        <p className="text-sm text-gray-400 mb-3">
          The current status controls which notification rules are active.
        </p>
        <div className="flex gap-2 flex-wrap">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => updateStatus(s)}
              className="px-4 py-1.5 rounded-md text-sm font-medium transition-opacity capitalize text-white hover:opacity-80"
              style={deviceStatus === s
                ? { background: '#FFB800', color: '#151925' }
                : { background: '#3A3A3A', color: '#ffffff' }
              }
            >
              {s}
              {deviceStatus === s && (
                <span className="ml-2">
                  <Badge label="Active" color={STATUS_COLOR[s]} />
                </span>
              )}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Detection">
        <SettingRow label="Timezone" hint="Used to display detection timestamps correctly.">
          <div className="flex items-center gap-2">
            <select
              value={allSettings.timezone ?? ''}
              onChange={e => saveSetting('timezone', e.target.value)}
              className={`${inputCls} w-full sm:w-72`}
              onFocus={e => e.target.style.borderColor = '#151925'}
              onBlur={e => e.target.style.borderColor = '#484848'}
            >
              <option value="">— Use browser default —</option>
              {TIMEZONES.map(tz => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
            {saving.timezone && <span className="text-xs text-gray-500">Saving…</span>}
            {saved.timezone && <span className="text-xs text-green-400">Saved ✓</span>}
          </div>
        </SettingRow>
        <SettingRow label="YOLO Model" hint="Larger models detect more accurately but run slower. Switching reloads the AI.">
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 flex-wrap">
              {[
                { id: 'yolov8n', label: 'Nano', sub: 'Fastest' },
                { id: 'yolov8s', label: 'Small', sub: 'Balanced' },
                { id: 'yolov8m', label: 'Medium', sub: 'Accurate' },
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => saveSetting('yolo_model', m.id)}
                  disabled={saving.yolo_model}
                  className="px-3 py-1.5 rounded-md text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={(allSettings.yolo_model ?? 'yolov8n') === m.id
                    ? { background: '#FFB800', color: '#151925' }
                    : { background: '#3A3A3A', color: '#ffffff' }
                  }
                >
                  {m.label} <span className="text-xs opacity-70">{m.sub}</span>
                </button>
              ))}
            </div>
            {saving.yolo_model && <p className="text-xs text-yellow-400">Loading model, please wait…</p>}
            {saved.yolo_model && <p className="text-xs text-green-400">Model loaded ✓</p>}
          </div>
        </SettingRow>
        <SettingRow label="Confidence thresholds" hint="Per-category minimum confidence. Higher = fewer false positives.">
          <ConfidenceSliders allSettings={allSettings} onSave={saveSetting} saving={saving} saved={saved} />
        </SettingRow>
        <SettingRow label="Motion threshold" hint="Pixel area. Higher = less sensitive to small motion.">
          <NumberInput
            keyName="motion_threshold"
            current={allSettings.motion_threshold ?? 500}
            min={100} max={5000} step={100}
            onSave={saveSetting}
            saving={saving.motion_threshold}
            saved={saved.motion_threshold}
          />
        </SettingRow>
      </Card>

      <Card title="SMS">
        <SettingRow label="Provider" hint="How SMS alerts are sent. Email Gateway is free but requires the recipient's carrier.">
          <div className="flex gap-2 flex-wrap">
            {[
              { id: 'twilio', label: 'Twilio', sub: 'Paid' },
              { id: 'email_gateway', label: 'Email Gateway', sub: 'Free' },
            ].map(p => (
              <button
                key={p.id}
                onClick={() => saveSetting('sms_provider', p.id)}
                disabled={saving.sms_provider}
                className="px-3 py-1.5 rounded-md text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                style={(allSettings.sms_provider ?? 'twilio') === p.id
                  ? { background: '#FFB800', color: '#151925' }
                  : { background: '#3A3A3A', color: '#ffffff' }
                }
              >
                {p.label} <span className="text-xs opacity-70">{p.sub}</span>
              </button>
            ))}
            {saved.sms_provider && <span className="text-xs text-green-400 self-center">Saved ✓</span>}
          </div>
        </SettingRow>
        {(allSettings.sms_provider ?? 'twilio') === 'twilio' && (<>
        <SettingRow label="Account SID">
          <TextInput keyName="twilio_account_sid" current={allSettings.twilio_account_sid ?? ''} onSave={saveSetting} saving={saving.twilio_account_sid} saved={saved.twilio_account_sid} placeholder="ACxxxxxxxxxxxxxxxx" />
        </SettingRow>
        <SettingRow label="Auth Token">
          <TextInput keyName="twilio_auth_token" current={allSettings.twilio_auth_token ?? ''} onSave={saveSetting} saving={saving.twilio_auth_token} saved={saved.twilio_auth_token} placeholder="••••••••" secret />
        </SettingRow>
        <SettingRow label="From Number">
          <TextInput keyName="twilio_from_number" current={allSettings.twilio_from_number ?? ''} onSave={saveSetting} saving={saving.twilio_from_number} saved={saved.twilio_from_number} placeholder="+1234567890" />
        </SettingRow>
        </>)}
      </Card>

      <Card title="Email (SMTP)">
        <SettingRow label="SMTP Host">
          <TextInput keyName="smtp_host" current={allSettings.smtp_host ?? ''} onSave={saveSetting} saving={saving.smtp_host} saved={saved.smtp_host} placeholder="smtp.gmail.com" />
        </SettingRow>
        <SettingRow label="SMTP Port">
          <NumberInput keyName="smtp_port" current={allSettings.smtp_port ?? 587} min={1} max={65535} step={1} onSave={saveSetting} saving={saving.smtp_port} saved={saved.smtp_port} />
        </SettingRow>
        <SettingRow label="Username">
          <TextInput keyName="smtp_username" current={allSettings.smtp_username ?? ''} onSave={saveSetting} saving={saving.smtp_username} saved={saved.smtp_username} placeholder="you@gmail.com" />
        </SettingRow>
        <SettingRow label="Password">
          <TextInput keyName="smtp_password" current={allSettings.smtp_password ?? ''} onSave={saveSetting} saving={saving.smtp_password} saved={saved.smtp_password} placeholder="••••••••" secret />
        </SettingRow>
        <SettingRow label="From Address">
          <TextInput keyName="smtp_from" current={allSettings.smtp_from ?? ''} onSave={saveSetting} saving={saving.smtp_from} saved={saved.smtp_from} placeholder="nomadeye@example.com" />
        </SettingRow>
      </Card>

      <CamerasCard />

      <Card title="Account">
        <SettingRow label="Sign out" hint="You will be returned to the login screen.">
          <button
            onClick={logout}
            className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-md transition-colors"
          >
            Sign Out
          </button>
        </SettingRow>
      </Card>

      </>}
    </div>
  )
}

function CamerasCard() {
  const [cams, setCams] = useState(null)
  const [confirm, setConfirm] = useState(null) // camera_id being confirmed for delete
  const [deleting, setDeleting] = useState(null)

  const load = useCallback(() => {
    camerasApi.list().then(r => setCams(r.data)).catch(() => setCams([]))
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id) => {
    if (confirm !== id) { setConfirm(id); return }
    setDeleting(id)
    try {
      await camerasApi.deletePermanent(id)
      load()
    } catch {}
    setDeleting(null)
    setConfirm(null)
  }

  if (!cams) return null

  return (
    <Card title="Cameras">
      <p className="text-xs text-gray-500 mb-3">All cameras ever connected. Offline cameras can be permanently deleted.</p>
      {cams.length === 0 && <p className="text-sm text-gray-500">No cameras registered yet.</p>}
      <div className="space-y-0">
        {cams.map(cam => {
          const isOffline = !cam.alive
          const isConfirming = confirm === cam.id
          const isDeleting = deleting === cam.id
          return (
            <div key={cam.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-[#3A3A3A] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white">{cam.name || `Camera ${cam.id}`}</span>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full"
                    style={cam.alive
                      ? { background: 'rgba(34,197,94,0.15)', color: '#4ADE80' }
                      : { background: 'rgba(156,163,175,0.15)', color: '#6B7280' }
                    }
                  >
                    {cam.alive ? 'Online' : 'Offline'}
                  </span>
                  <span className="text-xs text-gray-500">{cam.event_count} event{cam.event_count !== 1 ? 's' : ''}</span>
                </div>
                <p className="text-xs text-gray-600 font-mono mt-0.5 truncate">
                  {cam.device || cam.usb_id?.replace(/-video-index\d+$/, '') || '—'}
                </p>
                {cam.last_seen && isOffline && (
                  <p className="text-xs text-gray-700 mt-0.5">Last seen {new Date(cam.last_seen).toLocaleString()}</p>
                )}
              </div>
              {isOffline && (
                <div className="flex items-center gap-2 shrink-0">
                  {isConfirming ? (
                    <>
                      <span className="text-xs text-gray-400">Delete {cam.event_count} event{cam.event_count !== 1 ? 's' : ''}?</span>
                      <button
                        onClick={() => handleDelete(cam.id)}
                        disabled={isDeleting}
                        className="px-3 py-1 text-xs rounded-md transition-colors disabled:opacity-50"
                        style={{ background: '#EF4444', color: '#fff' }}
                      >
                        {isDeleting ? 'Deleting…' : 'Confirm Delete'}
                      </button>
                      <button onClick={() => setConfirm(null)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleDelete(cam.id)}
                      className="px-3 py-1 text-xs rounded-md transition-colors"
                      style={{ background: '#3A3A3A', color: '#F87171' }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function StorageTab() {
  return (
    <div className="space-y-6">
      <SystemStatsCard />
      <StorageLocationCard />
      <ExternalDevicesCard />
      <StorageCard />
      <RestartCard />
    </div>
  )
}

function fmtBytesLong(b) {
  if (!b) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, v = b
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function fmtUptime(secs) {
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function StatBar({ label, used, total, pct, color }) {
  const barColor = pct > 85 ? '#EF4444' : pct > 65 ? '#F59E0B' : color || '#4c6e5d'
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{label}</span>
        <span>{used !== undefined ? `${fmtBytesLong(used)} / ${fmtBytesLong(total)}` : `${pct.toFixed(0)}%`}</span>
      </div>
      <div className="w-full h-2 bg-[#3A3A3A] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
      </div>
    </div>
  )
}

function SystemStatsCard() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const load = useCallback(() => {
    systemApi.stats()
      .then(r => { setStats(r.data); setError(null) })
      .catch(e => setError(e.response?.data?.detail || 'Failed to load system stats'))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const iv = setInterval(load, 5000)
    return () => clearInterval(iv)
  }, [autoRefresh, load])

  const relevantDisks = stats?.disks?.filter(d =>
    d.mountpoint === '/' || d.mountpoint === '/home/arduino' || d.mountpoint?.startsWith('/mnt/')
  ) ?? []

  return (
    <Card title="System">
      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      {!stats && !error && <p className="text-sm text-gray-500">Loading...</p>}
      {stats && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">CPU</p>
              <p className="text-xl font-bold text-white">{stats.cpu_percent.toFixed(0)}<span className="text-sm text-gray-400">%</span></p>
              <p className="text-xs text-gray-600">{stats.cpu_count} core{stats.cpu_count !== 1 ? 's' : ''}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">RAM</p>
              <p className="text-xl font-bold text-white">{stats.memory_percent.toFixed(0)}<span className="text-sm text-gray-400">%</span></p>
              <p className="text-xs text-gray-600">{fmtBytesLong(stats.memory_available)} free</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Load (1m)</p>
              <p className="text-xl font-bold text-white">{stats.load_avg[0].toFixed(2)}</p>
              <p className="text-xs text-gray-600">{stats.load_avg[1].toFixed(2)} · {stats.load_avg[2].toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Uptime</p>
              <p className="text-xl font-bold text-white">{fmtUptime(stats.uptime_seconds)}</p>
              <p className="text-xs text-gray-600">system · svc {fmtUptime(stats.service_uptime_seconds)}</p>
            </div>
          </div>
          <div className="space-y-2.5 pt-1">
            <StatBar label="CPU" pct={stats.cpu_percent} color="#60A5FA" />
            <StatBar label="Memory" used={stats.memory_used} total={stats.memory_total} pct={stats.memory_percent} />
            {relevantDisks.map(d => (
              <StatBar
                key={d.mountpoint}
                label={`Disk (${d.mountpoint})`}
                used={d.used}
                total={d.total}
                pct={d.percent}
              />
            ))}
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={load}
              className="text-xs transition-colors hover:text-white"
              style={{ color: '#6B7280' }}
            >
              Refresh
            </button>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
                className="accent-[#FFB800] cursor-pointer"
              />
              <span className="text-xs" style={{ color: '#6B7280' }}>Auto-refresh (5s)</span>
            </label>
          </div>
        </div>
      )}
    </Card>
  )
}

function RestartCard() {
  const [svcState, setSvcState] = useState('idle')   // idle | confirming | working | done
  const [sysState, setSysState] = useState('idle')

  const pollUntilBack = (setS, timeoutMs) => {
    const start = Date.now()
    const iv = setInterval(async () => {
      if (Date.now() - start > timeoutMs) { clearInterval(iv); setS('idle'); return }
      try {
        await systemApi.stats()
        clearInterval(iv)
        setS('done')
        setTimeout(() => setS('idle'), 4000)
      } catch {}
    }, 2000)
  }

  const handleService = async () => {
    if (svcState === 'idle') { setSvcState('confirming'); return }
    if (svcState === 'confirming') {
      setSvcState('working')
      try { await systemApi.restart() } catch {}
      pollUntilBack(setSvcState, 60000)
    }
  }

  const handleReboot = async () => {
    if (sysState === 'idle') { setSysState('confirming'); return }
    if (sysState === 'confirming') {
      setSysState('working')
      try { await systemApi.reboot() } catch {}
      pollUntilBack(setSysState, 180000)
    }
  }

  const ActionRow = ({ label, hint, state, setS, onConfirm, workingMsg, doneMsg }) => (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 py-4 border-b border-[#3A3A3A] last:border-0">
      <div className="sm:w-48 shrink-0">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        {state === 'working' ? (
          <span className="text-sm text-yellow-400">{workingMsg}</span>
        ) : state === 'done' ? (
          <span className="text-sm text-green-400">{doneMsg}</span>
        ) : (
          <>
            <button
              onClick={onConfirm}
              className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
              style={state === 'confirming'
                ? { background: '#EF4444', color: '#fff' }
                : { background: '#3A3A3A', color: '#9CA3AF' }
              }
            >
              {state === 'confirming' ? `Confirm ${label}` : label}
            </button>
            {state === 'confirming' && (
              <button onClick={() => setS('idle')} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                Cancel
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )

  return (
    <Card title="System Restart">
      <ActionRow
        label="Restart Service"
        hint="Restarts only the Nomad Eye backend. ~15 seconds."
        state={svcState}
        setS={setSvcState}
        onConfirm={handleService}
        workingMsg="Restarting — reconnecting…"
        doneMsg="Service restarted ✓"
      />
      <ActionRow
        label="Reboot System"
        hint="Full Linux reboot. Cameras and all services restart. ~60–90 seconds."
        state={sysState}
        setS={setSysState}
        onConfirm={handleReboot}
        workingMsg="Rebooting — reconnecting…"
        doneMsg="System back online ✓"
      />
    </Card>
  )
}

function StorageLocationCard() {
  const [status, setStatus] = useState(null)
  const [switching, setSwitching] = useState(false)

  const load = useCallback(() => {
    storageApi.status().then(r => setStatus(r.data)).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const switchInternal = async () => {
    setSwitching(true)
    try { await storageApi.setPrimaryInternal(); load() } catch {}
    setSwitching(false)
  }

  if (!status) return null
  const diskPct = status.disk_total ? Math.round((status.disk_used / status.disk_total) * 100) : 0

  return (
    <Card title="Storage Location">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Active location:</span>
          <span className="text-sm font-mono text-white">{status.active_dir}</span>
          {status.using_external
            ? <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#4ADE80' }}>External</span>
            : <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.15)', color: '#A78BFA' }}>Internal</span>
          }
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Disk usage</span>
            <span>{fmtBytesLong(status.disk_used)} / {fmtBytesLong(status.disk_total)} · {fmtBytesLong(status.disk_free)} free</span>
          </div>
          <div className="w-full h-2 bg-[#3A3A3A] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{
              width: `${diskPct}%`,
              background: diskPct > 85 ? '#EF4444' : diskPct > 65 ? '#F59E0B' : '#4c6e5d',
            }} />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">{fmtBytesLong(status.image_bytes)} of images stored</span>
          {status.using_external && (
            <button
              onClick={switchInternal}
              disabled={switching}
              className="px-3 py-1 text-xs rounded-md transition-colors disabled:opacity-50"
              style={{ background: '#3A3A3A', color: '#9CA3AF' }}
            >
              {switching ? 'Switching…' : 'Switch to Internal'}
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

function ExternalDevicesCard() {
  const [devices, setDevices] = useState([])
  const [primary, setPrimary] = useState(null)
  const [pending, setPending] = useState({})
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState(null)
  const [scanning, setScanning] = useState(false)

  const load = useCallback(() => {
    storageApi.devices()
      .then(r => { setDevices(r.data.devices || []); setPrimary(r.data.primary); setError(null) })
      .catch(e => setError(e.response?.data?.detail || 'Failed to load devices — check your session'))
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (device, action, label) => {
    setError(null)
    setPending(p => ({ ...p, [`${device}-${action}`]: true }))
    try {
      if (action === 'mount') await storageApi.mount(device)
      else if (action === 'unmount') await storageApi.unmount(device)
      else if (action === 'format') await storageApi.format(device)
      else if (action === 'set-primary') await storageApi.setPrimary(device)
      load()
    } catch (e) {
      setError(e.response?.data?.detail || `${label} failed`)
    }
    setPending(p => ({ ...p, [`${device}-${action}`]: false }))
    setConfirm(null)
  }

  const scan = async () => {
    setScanning(true)
    load()
    setTimeout(() => setScanning(false), 800)
  }

  return (
    <Card title="External Storage Devices">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">USB drives and SD cards. Plug in a device, mount it, then set it as primary.</p>
        <button
          onClick={scan}
          disabled={scanning}
          className="px-3 py-1 text-xs rounded-md transition-colors disabled:opacity-50"
          style={{ background: '#3A3A3A', color: '#9CA3AF' }}
        >
          {scanning ? 'Scanning…' : 'Scan'}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400 mb-3">{error}</p>
      )}

      {devices.length === 0 ? (
        <p className="text-sm text-gray-500">No external devices detected.</p>
      ) : (
        <div className="space-y-3">
          {devices.map(dev => {
            const mounted = !!dev.mountpoint
            const isPrimary = dev.name === primary
            return (
              <div key={dev.name} className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 border-b border-[#3A3A3A] last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono text-white">/dev/{dev.name}</span>
                    <span className="text-xs text-gray-500">{dev.size}</span>
                    {dev.label && <span className="text-xs text-gray-400">"{dev.label}"</span>}
                    {dev.fstype && <span className="text-xs text-gray-600">{dev.fstype}</span>}
                    {isPrimary && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,184,0,0.15)', color: '#FFB800' }}>Primary</span>}
                    {mounted && !isPrimary && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#4ADE80' }}>Mounted</span>}
                    {!mounted && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(156,163,175,0.15)', color: '#6B7280' }}>Not mounted</span>}
                  </div>
                  {mounted && <p className="text-xs text-gray-600 font-mono mt-0.5">{dev.mountpoint}</p>}
                  {dev.model && <p className="text-xs text-gray-600 mt-0.5">{dev.model}</p>}
                </div>
                <div className="flex gap-2 flex-wrap shrink-0">
                  {!mounted && (
                    <button
                      onClick={() => act(dev.name, 'mount', 'Mount')}
                      disabled={!!pending[`${dev.name}-mount`]}
                      className="px-3 py-1 text-xs rounded-md disabled:opacity-50 transition-colors"
                      style={{ background: '#3A3A3A', color: '#4ADE80' }}
                    >
                      {pending[`${dev.name}-mount`] ? 'Mounting…' : 'Mount'}
                    </button>
                  )}
                  {mounted && !isPrimary && (
                    <button
                      onClick={() => act(dev.name, 'set-primary', 'Set Primary')}
                      disabled={!!pending[`${dev.name}-set-primary`]}
                      className="px-3 py-1 text-xs rounded-md disabled:opacity-50 transition-colors"
                      style={{ background: 'rgba(255,184,0,0.15)', color: '#FFB800' }}
                    >
                      {pending[`${dev.name}-set-primary`] ? 'Setting…' : 'Use for Images'}
                    </button>
                  )}
                  {mounted && (
                    <button
                      onClick={() => act(dev.name, 'unmount', 'Eject')}
                      disabled={!!pending[`${dev.name}-unmount`]}
                      className="px-3 py-1 text-xs rounded-md disabled:opacity-50 transition-colors"
                      style={{ background: '#3A3A3A', color: '#9CA3AF' }}
                    >
                      {pending[`${dev.name}-unmount`] ? 'Ejecting…' : 'Eject'}
                    </button>
                  )}
                  {confirm === dev.name ? (
                    <>
                      <button
                        onClick={() => act(dev.name, 'format', 'Format')}
                        disabled={!!pending[`${dev.name}-format`]}
                        className="px-3 py-1 text-xs rounded-md disabled:opacity-50 transition-colors"
                        style={{ background: '#EF4444', color: '#fff' }}
                      >
                        {pending[`${dev.name}-format`] ? 'Formatting…' : 'Confirm Format'}
                      </button>
                      <button onClick={() => setConfirm(null)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirm(dev.name)}
                      className="px-3 py-1 text-xs rounded-md transition-colors"
                      style={{ background: '#3A3A3A', color: '#F87171' }}
                    >
                      Format
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

const PURGE_CATEGORIES = ['all', 'people', 'vehicles', 'animals', 'other']
const CATEGORY_STYLE = {
  people:   { background: 'rgba(239,68,68,0.15)',   color: '#F87171' },
  vehicles: { background: 'rgba(59,130,246,0.15)',  color: '#60A5FA' },
  animals:  { background: 'rgba(34,197,94,0.15)',   color: '#4ADE80' },
  other:    { background: 'rgba(245,158,11,0.15)',  color: '#FCD34D' },
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function StorageCard() {
  const [storage, setStorage] = useState(null)
  const [purgeCategory, setPurgeCategory] = useState('all')
  const [imagesOnly, setImagesOnly] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [purging, setPurging] = useState(false)
  const [result, setResult] = useState(null)

  const load = useCallback(() => {
    detectionsApi.storage().then(r => setStorage(r.data)).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const handlePurge = async () => {
    if (!confirm) { setConfirm(true); return }
    setPurging(true)
    setConfirm(false)
    setResult(null)
    try {
      const r = await detectionsApi.purge(purgeCategory, imagesOnly)
      setResult(r.data)
      load()
    } catch {}
    setPurging(false)
  }

  const diskPct = storage ? Math.round((storage.disk_used / storage.disk_total) * 100) : 0
  const imgPct = storage ? Math.min(100, (storage.image_bytes / storage.disk_total) * 100) : 0

  return (
    <Card title="Storage">
      {storage ? (
        <div className="mb-5 space-y-4">
          {/* Disk usage bar */}
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Disk Usage</span>
              <span>{fmtBytes(storage.disk_used)} / {fmtBytes(storage.disk_total)} &nbsp;·&nbsp; {fmtBytes(storage.disk_free)} free</span>
            </div>
            <div className="w-full h-3 bg-[#3A3A3A] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${diskPct}%`,
                  background: diskPct > 85 ? '#EF4444' : diskPct > 65 ? '#F59E0B' : '#4c6e5d',
                }}
              />
            </div>
          </div>

          {/* Image storage bar */}
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Detection Images</span>
              <span>{fmtBytes(storage.image_bytes)}</span>
            </div>
            <div className="w-full h-3 bg-[#3A3A3A] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(imgPct, storage.image_bytes > 0 ? 0.5 : 0)}%`, background: '#FFB800' }}
              />
            </div>
          </div>

          {/* Per-category counts */}
          <div className="flex flex-wrap gap-2 pt-1">
            {Object.entries(storage.by_category).map(([cat, n]) => (
              <span
                key={cat}
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize"
                style={CATEGORY_STYLE[cat] || { background: 'rgba(156,163,175,0.15)', color: '#9CA3AF' }}
              >
                {cat}: {n}
              </span>
            ))}
            <span className="text-xs text-gray-500 self-center">{storage.total_detections} total events</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-500 mb-4">Loading storage info...</p>
      )}

      <div className="border-t border-[#3A3A3A] pt-4 space-y-3">
        <p className="text-sm font-medium text-white">Purge Detections</p>

        <div>
          <p className="text-xs text-gray-500 mb-1.5">Category</p>
          <div className="flex gap-1.5 flex-wrap">
            {PURGE_CATEGORIES.map(c => (
              <button
                key={c}
                onClick={() => { setPurgeCategory(c); setConfirm(false); setResult(null) }}
                className="px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-opacity hover:opacity-80"
                style={purgeCategory === c
                  ? { background: '#FFB800', color: '#151925' }
                  : { background: '#3A3A3A', color: '#ffffff' }
                }
              >{c}</button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <div
            className="relative flex-shrink-0 rounded-full transition-colors duration-200"
            style={{ width: 36, height: 20, background: imagesOnly ? '#FFB800' : '#484848' }}
            onClick={() => { setImagesOnly(v => !v); setConfirm(false) }}
          >
            <div
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200"
              style={{ left: imagesOnly ? 16 : 2 }}
            />
          </div>
          <span className="text-sm text-gray-300">Delete images only (keep detection records)</span>
        </label>

        {result && (
          <p className="text-xs text-green-400">
            Done — {result.deleted_records} records removed, {result.deleted_images} images deleted.
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handlePurge}
            disabled={purging}
            className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            style={confirm
              ? { background: '#EF4444', color: '#ffffff' }
              : { background: '#3A3A3A', color: '#ffffff' }
            }
          >
            {purging ? 'Purging…' : confirm ? 'Confirm — this cannot be undone' : 'Purge'}
          </button>
          {confirm && (
            <button onClick={() => setConfirm(false)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              Cancel
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

const CONF_CATEGORIES = [
  { key: 'confidence_people',   label: 'People',   color: '#F87171' },
  { key: 'confidence_vehicles', label: 'Vehicles', color: '#60A5FA' },
  { key: 'confidence_animals',  label: 'Animals',  color: '#4ADE80' },
  { key: 'confidence_other',    label: 'Other',    color: '#FCD34D' },
]

function ConfidenceSliders({ allSettings, onSave, saving, saved }) {
  const [vals, setVals] = useState(() =>
    Object.fromEntries(CONF_CATEGORIES.map(c => [c.key, parseFloat(allSettings[c.key] ?? 0.5)]))
  )
  useEffect(() => {
    setVals(Object.fromEntries(CONF_CATEGORIES.map(c => [c.key, parseFloat(allSettings[c.key] ?? 0.5)])))
  }, [allSettings])

  return (
    <div className="space-y-3">
      {CONF_CATEGORIES.map(({ key, label, color }) => (
        <div key={key} className="flex items-center gap-3">
          <span className="text-xs font-medium w-16 shrink-0" style={{ color }}>{label}</span>
          <input
            type="range"
            min={0.05} max={0.95} step={0.05}
            value={vals[key]}
            onChange={e => setVals(v => ({ ...v, [key]: parseFloat(e.target.value) }))}
            onMouseUp={e => onSave(key, parseFloat(e.target.value))}
            onTouchEnd={e => onSave(key, vals[key])}
            className="flex-1 accent-[#FFB800] cursor-pointer"
          />
          <span className="text-xs font-mono text-gray-300 w-9 text-right shrink-0">
            {Math.round(vals[key] * 100)}%
          </span>
          {saving[key] && <span className="text-xs text-gray-500 shrink-0">…</span>}
          {saved[key] && <span className="text-xs text-green-400 shrink-0">✓</span>}
        </div>
      ))}
    </div>
  )
}

function TextInput({ keyName, current, onSave, saving, saved, placeholder, secret }) {
  const [val, setVal] = useState(current)
  const dirty = val !== current && val !== ''
  return (
    <div className="flex items-center gap-2">
      <input
        type={secret ? 'password' : 'text'}
        value={val}
        onChange={e => setVal(e.target.value)}
        placeholder={placeholder}
        className={`${inputCls} w-full sm:w-64`}
        onFocus={e => e.target.style.borderColor = '#151925'}
        onBlur={e => e.target.style.borderColor = '#484848'}
      />
      <button
        onClick={() => onSave(keyName, val)}
        disabled={saving || (!val && !dirty)}
        className="px-3 py-1.5 disabled:opacity-40 text-white text-sm rounded-md transition-opacity hover:opacity-90"
        style={{ background: '#FFB800', color: '#151925' }}
      >
        {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
      </button>
    </div>
  )
}

function NumberInput({ keyName, current, min, max, step, onSave, saving, saved }) {
  const [val, setVal] = useState(current)
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={val}
        onChange={e => setVal(parseFloat(e.target.value))}
        min={min} max={max} step={step}
        className={`${inputCls} w-28`}
        onFocus={e => e.target.style.borderColor = '#151925'}
        onBlur={e => e.target.style.borderColor = '#484848'}
      />
      <button
        onClick={() => onSave(keyName, val)}
        disabled={saving}
        className="px-3 py-1.5 disabled:opacity-40 text-white text-sm rounded-md transition-opacity hover:opacity-90"
        style={{ background: '#FFB800', color: '#151925' }}
      >
        {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
      </button>
    </div>
  )
}
