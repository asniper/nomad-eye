import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { settings, detections as detectionsApi, storage as storageApi, system as systemApi, cameras as camerasApi, faces as facesApi } from '../api/client'

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

const DEFAULT_WILDLIFE_CLASSES = "deer, moose, elk, bear, mountain lion, bobcat, coyote, fox, raccoon, skunk, rabbit, squirrel, groundhog, muskrat, ferret, cat, dog, bird, person, car, truck, bus, motorcycle, bicycle, van, ATV, snowmobile"

const DETECTION_MODELS = [
  { key: 'yolov8n', name: 'YOLOv8 Nano', speed: 'Fast', openVocab: false, requiresInstall: false,
    description: 'Fastest standard model. Detects people, vehicles, and common animals: cat, dog, bird, bear, horse, cow, sheep. Does not detect deer, moose, or most North American wildlife.' },
  { key: 'yolov8s', name: 'YOLOv8 Small', speed: 'Medium', openVocab: false, requiresInstall: false,
    description: 'More accurate than Nano with the same COCO-80 classes. Better at detecting small or distant subjects.' },
  { key: 'yolov8m', name: 'YOLOv8 Medium', speed: 'Slow', openVocab: false, requiresInstall: false,
    description: 'Highest accuracy of the standard YOLO line. Same COCO-80 classes. Significantly slower on ARM — best with a fast CPU.' },
  { key: 'yolov8s-worldv2', name: 'YOLOWorld', speed: 'Medium', openVocab: true, requiresInstall: false,
    description: 'Open-vocabulary YOLO — you define what to detect. Add deer, moose, elk, mountain lion, bobcat, etc. ~44 MB download on first use. Best balance of speed and North American wildlife detection.' },
  { key: 'megadetector', name: 'MegaDetector v5', speed: 'Medium', openVocab: false, requiresInstall: false,
    description: "Trained on millions of wildlife camera trap images by Microsoft. Detects any animal (deer, moose, elk, mountain lion — anything) as 'animal'. Also detects people and vehicles. ~220 MB download. Best raw wildlife sensitivity; does not identify specific species." },
  { key: 'owlv2', name: 'OWLv2', speed: 'Very Slow', openVocab: true, requiresInstall: true,
    description: "Google's open-vocabulary vision transformer. Define any class by name — high accuracy on rare or unusual species. Very slow on CPU (10–30s/scan); only practical with the 30s periodic scan. Requires transformers library (~2 GB download)." },
  { key: 'grounding-dino', name: 'Grounding DINO', speed: 'Very Slow', openVocab: true, requiresInstall: true,
    description: 'Powerful open-vocabulary detection — describe objects in natural language. Very slow on CPU. Useful for difficult or rare subjects. Requires transformers library.' },
]

const SPEED_STYLE = {
  'Fast':      { background: 'rgba(34,197,94,0.15)',   color: '#4ADE80' },
  'Medium':    { background: 'rgba(255,184,0,0.15)',   color: '#FFB800' },
  'Slow':      { background: 'rgba(249,115,22,0.15)',  color: '#FB923C' },
  'Very Slow': { background: 'rgba(239,68,68,0.15)',   color: '#F87171' },
}

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
  { id: 'detection', label: 'Detection' },
  { id: 'faces', label: 'Faces' },
  { id: 'network', label: 'Network' },
  { id: 'storage', label: 'Storage' },
  { id: 'system', label: 'System' },
]

export default function Settings() {
  const { logout } = useAuth()
  const { deviceStatus, updateStatus } = useDeviceStatus()
  const [allSettings, setAllSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [saved, setSaved] = useState({})
  const [errors, setErrors] = useState({})
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
    setErrors(s => ({ ...s, [key]: null }))
    try {
      await settings.set(key, value)
      setAllSettings(s => ({ ...s, [key]: value }))
      if (key === 'timezone') setTimezone(value)
      setSaved(s => ({ ...s, [key]: true }))
      setTimeout(() => setSaved(s => ({ ...s, [key]: false })), 2000)
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Failed to save — check device logs.'
      setErrors(s => ({ ...s, [key]: msg }))
    }
    setSaving(s => ({ ...s, [key]: false }))
  }

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-2xl font-bold" style={{ color: '#FFB800' }}>Settings</h2>
        <div className="overflow-x-auto" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          <div className="flex gap-1 border-b border-[#3A3A3A] min-w-max">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => changeTab(t.id)}
                className="px-4 py-1.5 text-sm font-medium transition-colors rounded-t-md whitespace-nowrap shrink-0"
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
      </div>

      {tab === 'network' && <Network />}
      {tab === 'storage' && <StorageTab />}
      {tab === 'system' && <SystemTab allSettings={allSettings} saveSetting={saveSetting} saving={saving} saved={saved} />}
      {tab === 'faces' && <FacesTab />}
      {tab === 'detection' && <>
        <Card title="Detection">
          {/* AI enabled toggle */}
          <div className="flex items-center justify-between py-3 mb-2 border-b border-[#3A3A3A]">
            <div>
              <p className="text-sm font-medium text-white">AI Detection</p>
              <p className="text-xs text-gray-500 mt-0.5">Enable or disable all AI-based object and face detection.</p>
            </div>
            <button
              onClick={() => saveSetting('ai_enabled', (allSettings.ai_enabled ?? '1') === '0' ? '1' : '0')}
              className="relative w-11 h-6 rounded-full transition-colors shrink-0"
              style={{ background: (allSettings.ai_enabled ?? '1') !== '0' ? '#FFB800' : '#3A3A3A' }}
            >
              <span
                className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all"
                style={{ left: (allSettings.ai_enabled ?? '1') !== '0' ? '1.375rem' : '0.25rem' }}
              />
            </button>
          </div>
          <div className={(allSettings.ai_enabled ?? '1') === '0' ? 'opacity-40 pointer-events-none select-none' : ''}>
          <SettingRow label="Detection Model" hint="The AI model used to classify detected motion. Switching downloads and loads the new model — may take a minute.">
            <ModelSelector allSettings={allSettings} onSave={saveSetting} saving={saving} saved={saved} errors={errors} />
          </SettingRow>
          <SettingRow label="Confidence thresholds" hint="Per-category minimum confidence. Higher = fewer false positives.">
            <ConfidenceSliders allSettings={allSettings} onSave={saveSetting} saving={saving} saved={saved} />
          </SettingRow>
          <SettingRow label="Motion threshold" hint="Pixel area. Higher = less sensitive to small motion.">
            <NumberInput
              keyName="motion_threshold"
              current={allSettings.motion_threshold ?? 100}
              min={100} max={5000} step={100}
              onSave={saveSetting}
              saving={saving.motion_threshold}
              saved={saved.motion_threshold}
            />
          </SettingRow>
          <SettingRow label="Motion detection scale" hint="Resolution used for motion detection. Lower = less CPU, slightly less precise.">
            <div className="flex gap-2 flex-wrap">
              {[
                { id: '1.0', label: 'Full', sub: '1280×720' },
                { id: '0.5', label: 'Half', sub: '640×360' },
                { id: '0.25', label: 'Quarter', sub: '320×180' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => saveSetting('motion_scale', opt.id)}
                  disabled={saving.motion_scale}
                  className="px-3 py-1.5 rounded-md text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={(allSettings.motion_scale ?? '0.5') === opt.id
                    ? { background: '#FFB800', color: '#151925' }
                    : { background: '#3A3A3A', color: '#ffffff' }
                  }
                >
                  {opt.label} <span className="text-xs opacity-70">{opt.sub}</span>
                </button>
              ))}
              {saved.motion_scale && <span className="text-xs text-green-400 self-center">Saved ✓</span>}
            </div>
          </SettingRow>
          <SettingRow label="Detection interval" hint="Seconds between AI scans when motion is active. Lower = more responsive, more CPU.">
            <NumberInput
              keyName="detection_cooldown"
              current={parseFloat(allSettings.detection_cooldown ?? 3.0)}
              min={0.5} max={30} step={0.5}
              onSave={saveSetting}
              saving={saving.detection_cooldown}
              saved={saved.detection_cooldown}
            />
          </SettingRow>
          </div>
        </Card>
        <CamerasCard allSettings={allSettings} saveSetting={saveSetting} saving={saving} saved={saved} />
      </>}

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
          <TextInput keyName="twilio_account_sid" current={allSettings.twilio_account_sid ?? ''} onSave={saveSetting} saving={saving.twilio_account_sid} saved={saved.twilio_account_sid} error={errors.twilio_account_sid} placeholder="ACxxxxxxxxxxxxxxxx" />
        </SettingRow>
        <SettingRow label="Auth Token">
          <TextInput keyName="twilio_auth_token" current={allSettings.twilio_auth_token ?? ''} onSave={saveSetting} saving={saving.twilio_auth_token} saved={saved.twilio_auth_token} error={errors.twilio_auth_token} placeholder="••••••••" secret />
        </SettingRow>
        <SettingRow label="From Number">
          <TextInput keyName="twilio_from_number" current={allSettings.twilio_from_number ?? ''} onSave={saveSetting} saving={saving.twilio_from_number} saved={saved.twilio_from_number} error={errors.twilio_from_number} placeholder="+1234567890" />
        </SettingRow>
        </>)}
      </Card>

      <Card title="Email (SMTP)">
        <SettingRow label="SMTP Host">
          <TextInput keyName="smtp_host" current={allSettings.smtp_host ?? ''} onSave={saveSetting} saving={saving.smtp_host} saved={saved.smtp_host} error={errors.smtp_host} placeholder="smtp.gmail.com" />
        </SettingRow>
        <SettingRow label="SMTP Port">
          <NumberInput keyName="smtp_port" current={allSettings.smtp_port ?? 587} min={1} max={65535} step={1} onSave={saveSetting} saving={saving.smtp_port} saved={saved.smtp_port} />
        </SettingRow>
        <SettingRow label="Username">
          <TextInput keyName="smtp_username" current={allSettings.smtp_username ?? ''} onSave={saveSetting} saving={saving.smtp_username} saved={saved.smtp_username} error={errors.smtp_username} placeholder="you@gmail.com" />
        </SettingRow>
        <SettingRow label="Password">
          <TextInput keyName="smtp_password" current={allSettings.smtp_password ?? ''} onSave={saveSetting} saving={saving.smtp_password} saved={saved.smtp_password} error={errors.smtp_password} placeholder="••••••••" secret />
        </SettingRow>
        <SettingRow label="From Address">
          <TextInput keyName="smtp_from" current={allSettings.smtp_from ?? ''} onSave={saveSetting} saving={saving.smtp_from} saved={saved.smtp_from} error={errors.smtp_from} placeholder="nomadeye@example.com" />
        </SettingRow>
      </Card>

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

function CamerasCard({ allSettings, saveSetting, saving, saved }) {
  const [cams, setCams] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [togglingEnabled, setTogglingEnabled] = useState(null)

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
              <div className="flex items-center gap-3 shrink-0">
                {/* Enable/disable toggle */}
                <button
                  disabled={togglingEnabled === cam.id}
                  onClick={async () => {
                    setTogglingEnabled(cam.id)
                    try {
                      await camerasApi.setEnabled(cam.id, !cam.enabled)
                      load()
                    } catch {}
                    setTogglingEnabled(null)
                  }}
                  className="relative w-9 h-5 rounded-full transition-colors shrink-0"
                  style={{ background: cam.enabled ? '#22C55E' : '#3A3A3A', opacity: togglingEnabled === cam.id ? 0.5 : 1 }}
                  title={cam.enabled ? 'Disable camera' : 'Enable camera'}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all"
                    style={{ left: cam.enabled ? '1.125rem' : '0.125rem' }}
                  />
                </button>

                {/* Delete (offline only) */}
                {isOffline && (
                  isConfirming ? (
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
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Video Quality */}
      {(() => {
        const aiOn = (allSettings?.ai_enabled ?? '1') !== '0'
        const res = allSettings?.video_resolution ?? '1280x720'
        const fps = allSettings?.video_fps ?? '15'
        return (
          <div className="mt-4 pt-4 border-t border-[#3A3A3A]">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-sm font-medium text-white">Video Quality</p>
              {aiOn && (
                <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(255,184,0,0.15)', color: '#FFB800' }}>
                  Overridden by AI (1280×720 @ 15 fps)
                </span>
              )}
            </div>
            <div className={`flex flex-wrap gap-4 ${aiOn ? 'opacity-40 pointer-events-none select-none' : ''}`}>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Resolution</label>
                <div className="flex gap-1.5 flex-wrap">
                  {[
                    { label: '640×480', value: '640x480' },
                    { label: '1280×720', value: '1280x720' },
                    { label: '1920×1080', value: '1920x1080' },
                  ].map(r => (
                    <button
                      key={r.value}
                      onClick={() => {
                        const [w, h] = r.value.split('x').map(Number)
                        saveSetting('video_resolution', r.value)
                        saveSetting('video_width', String(w))
                        saveSetting('video_height', String(h))
                      }}
                      className="px-3 py-1 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
                      style={res === r.value
                        ? { background: '#FFB800', color: '#151925' }
                        : { background: '#3A3A3A', color: '#9CA3AF' }
                      }
                    >{r.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Frame Rate</label>
                <div className="flex gap-1.5 flex-wrap">
                  {['10', '15', '24', '30'].map(f => (
                    <button
                      key={f}
                      onClick={() => saveSetting('video_fps', f)}
                      className="px-3 py-1 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
                      style={fps === f
                        ? { background: '#FFB800', color: '#151925' }
                        : { background: '#3A3A3A', color: '#9CA3AF' }
                      }
                    >{f} fps</button>
                  ))}
                </div>
              </div>
              {(saved?.video_fps || saved?.video_resolution) && (
                <p className="text-xs text-green-400 self-end mb-0.5">Saved — reload cameras to apply</p>
              )}
            </div>
          </div>
        )
      })()}
    </Card>
  )
}

function FacesTab() {
  return (
    <div className="space-y-6">
      <FacesCard />
    </div>
  )
}

function FacesCard() {
  const [faces, setFaces] = useState(null)
  const [backend, setBackend] = useState(null)
  const [managingGroupName, setManagingGroupName] = useState(null)

  const load = useCallback(() => {
    facesApi.list().then(r => setFaces(r.data)).catch(() => setFaces([]))
    facesApi.backend().then(r => setBackend(r.data.backend)).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const { knownGroups, unknownGroup } = useMemo(() => {
    if (!faces) return { knownGroups: [], unknownGroup: null }
    const map = {}
    faces.forEach(face => {
      if (!map[face.name]) map[face.name] = { name: face.name, faces: [] }
      map[face.name].faces.push(face)
    })
    const all = Object.values(map)
    return {
      knownGroups: all.filter(g => g.name !== 'Unknown').sort((a, b) => a.name.localeCompare(b.name)),
      unknownGroup: all.find(g => g.name === 'Unknown') ?? null,
    }
  }, [faces])

  const knownNames = useMemo(() => knownGroups.map(g => g.name), [knownGroups])
  const allGroups = useMemo(() => [...knownGroups, ...(unknownGroup ? [unknownGroup] : [])], [knownGroups, unknownGroup])
  const managingGroup = managingGroupName ? allGroups.find(g => g.name === managingGroupName) ?? null : null

  useEffect(() => {
    if (managingGroupName && !managingGroup) setManagingGroupName(null)
  }, [managingGroup, managingGroupName])

  return (
    <Card title="Faces">
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <p className="text-sm text-gray-400 flex-1">
          Faces are detected and grouped automatically. Assign unknowns to build recognition for known people.
        </p>
        {backend && (
          <span className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(168,85,247,0.15)', color: '#C084FC' }}>
            {backend === 'face_recognition' ? 'dlib (high accuracy)' : 'OpenCV Haar (basic)'}
          </span>
        )}
      </div>

      {faces === null && <p className="text-sm text-gray-500">Loading…</p>}
      {faces !== null && faces.length === 0 && (
        <p className="text-sm text-gray-500">No faces captured yet. Faces will appear here automatically when detected.</p>
      )}

      {knownGroups.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Identified</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {knownGroups.map(group => (
              <FaceGroupCard key={group.name} group={group} onManage={() => setManagingGroupName(group.name)} />
            ))}
          </div>
        </div>
      )}

      {unknownGroup && (
        <div className={knownGroups.length > 0 ? 'border-t border-[#3A3A3A] pt-4' : ''}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              Unknown <span className="normal-case font-normal">({unknownGroup.faces.length})</span>
            </p>
            <button
              onClick={() => setManagingGroupName('Unknown')}
              className="text-xs hover:opacity-80 transition-opacity"
              style={{ color: '#A855F7' }}
            >
              Manage all
            </button>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
            {unknownGroup.faces.slice(0, 16).map(face => (
              <UnknownFaceTile key={face.id} face={face} knownNames={knownNames} onUpdate={load} />
            ))}
            {unknownGroup.faces.length > 16 && (
              <button
                onClick={() => setManagingGroupName('Unknown')}
                className="aspect-square rounded-lg flex items-center justify-center text-xs hover:opacity-80 transition-opacity"
                style={{ background: '#2A2A2A', border: '1px solid #3A3A3A', color: '#9CA3AF' }}
              >
                +{unknownGroup.faces.length - 16}
              </button>
            )}
          </div>
        </div>
      )}

      {managingGroup && (
        <FaceManageModal
          group={managingGroup}
          knownNames={knownNames}
          onClose={() => setManagingGroupName(null)}
          onUpdate={load}
        />
      )}
    </Card>
  )
}

function FaceThumb({ faceId }) {
  const [imgUrl, setImgUrl] = useState(null)
  useEffect(() => {
    let url
    facesApi.image(faceId)
      .then(r => { url = URL.createObjectURL(r.data); setImgUrl(url) })
      .catch(() => {})
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [faceId])

  if (!imgUrl) return (
    <div className="w-full h-full flex items-center justify-center bg-[#1E1E1E]">
      <span style={{ color: '#A855F7', fontSize: '1.1rem' }}>?</span>
    </div>
  )
  return <img src={imgUrl} alt="" className="w-full h-full object-cover" />
}

function FaceGroupCard({ group, onManage }) {
  const preview = group.faces.slice(0, 4)
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: '#2A2A2A', border: '1px solid #3A3A3A' }}>
      <div className="relative" style={{ aspectRatio: '1' }}>
        {preview.length === 1 ? (
          <div className="absolute inset-0"><FaceThumb faceId={preview[0].id} /></div>
        ) : (
          <div className="absolute inset-0 grid grid-cols-2 gap-px" style={{ background: '#3A3A3A' }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="overflow-hidden bg-[#1E1E1E]">
                {preview[i] && <FaceThumb faceId={preview[i].id} />}
              </div>
            ))}
          </div>
        )}
        {group.faces.length > 1 && (
          <div className="absolute bottom-1 right-1 px-1 rounded text-[10px] font-semibold"
            style={{ background: 'rgba(0,0,0,0.65)', color: '#E5E7EB' }}>
            {group.faces.length}
          </div>
        )}
      </div>
      <div className="p-1.5 space-y-1">
        <p className="text-xs font-medium truncate text-white">{group.name}</p>
        <button onClick={onManage} className="w-full text-xs py-0.5 rounded hover:opacity-80 transition-opacity"
          style={{ background: '#3A3A3A', color: '#A855F7' }}>
          Manage
        </button>
      </div>
    </div>
  )
}

function UnknownFaceTile({ face, knownNames, onUpdate }) {
  const [assigning, setAssigning] = useState(false)
  const [mode, setMode] = useState('select') // 'select' | 'new'
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  const handleAssign = async (name) => {
    setSaving(true)
    try { await facesApi.rename(face.id, name); onUpdate() } catch {}
    setSaving(false)
    setAssigning(false)
    setMode('select')
    setNewName('')
  }

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: '#2A2A2A', border: '1px solid #3A3A3A' }}>
      <div className="aspect-square"><FaceThumb faceId={face.id} /></div>
      <div className="p-1">
        {assigning ? (
          mode === 'new' ? (
            <div className="flex gap-0.5">
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newName.trim()) handleAssign(newName.trim())
                  if (e.key === 'Escape') { setAssigning(false); setMode('select'); setNewName('') }
                }}
                placeholder="Name…"
                className="flex-1 min-w-0 text-[10px] rounded px-1 py-0.5 focus:outline-none"
                style={{ background: '#3A3A3A', border: '1px solid #A855F7', color: '#fff' }}
              />
              <button onClick={() => newName.trim() && handleAssign(newName.trim())}
                disabled={!newName.trim() || saving}
                className="text-[10px] px-1 rounded disabled:opacity-30"
                style={{ background: '#A855F7', color: '#fff' }}>✓</button>
            </div>
          ) : (
            <select
              autoFocus
              className="w-full text-[10px] rounded px-1 py-0.5 focus:outline-none"
              style={{ background: '#3A3A3A', border: '1px solid #555', color: '#E5E7EB' }}
              defaultValue=""
              onChange={e => {
                if (e.target.value === '__new__') setMode('new')
                else if (e.target.value) handleAssign(e.target.value)
              }}
              onBlur={() => { if (mode === 'select') setAssigning(false) }}
            >
              <option value="" disabled>Who is this?</option>
              {knownNames.map(n => <option key={n} value={n}>{n}</option>)}
              <option value="__new__">+ New person…</option>
            </select>
          )
        ) : (
          <button onClick={() => setAssigning(true)}
            className="w-full text-[10px] py-0.5 rounded hover:opacity-80 transition-opacity"
            style={{ background: '#3A3A3A', color: '#A855F7' }}>
            Assign
          </button>
        )}
      </div>
    </div>
  )
}

function FaceManageModal({ group, knownNames, onClose, onUpdate }) {
  const [assigningId, setAssigningId] = useState(null)
  const [assignMode, setAssignMode] = useState('select') // 'select' | 'new'
  const [newName, setNewName] = useState('')
  const [deletingId, setDeletingId] = useState(null)
  const [clearingAll, setClearingAll] = useState(false)
  const [renamingGroup, setRenamingGroup] = useState(false)
  const [groupNameInput, setGroupNameInput] = useState(group.name)
  const [renamingSaving, setRenamingSaving] = useState(false)
  const isUnknown = group.name === 'Unknown'

  const startAssigning = (faceId) => {
    setAssigningId(faceId)
    setAssignMode('select')
    setNewName('')
  }

  const handleAssign = async (faceId, name) => {
    setAssigningId(null)
    setAssignMode('select')
    setNewName('')
    try { await facesApi.rename(faceId, name); onUpdate() } catch {}
  }

  const handleDelete = async (faceId) => {
    setDeletingId(faceId)
    try { await facesApi.delete(faceId); onUpdate() } catch {}
    setDeletingId(null)
  }

  const handleDisassociate = async (faceId) => {
    try { await facesApi.disassociate(faceId); onUpdate() } catch {}
  }

  const handleRenameGroup = async () => {
    const trimmed = groupNameInput.trim()
    if (!trimmed || trimmed === group.name) { setRenamingGroup(false); return }
    setRenamingSaving(true)
    for (const face of group.faces) {
      try { await facesApi.rename(face.id, trimmed) } catch {}
    }
    setRenamingSaving(false)
    setRenamingGroup(false)
    onUpdate()
    onClose()
  }

  const handleClearAll = async () => {
    if (!confirm(`Delete all ${group.faces.length} samples for "${group.name}"?`)) return
    setClearingAll(true)
    try {
      if (isUnknown) {
        await facesApi.deleteUnknown()
      } else {
        for (const face of group.faces) {
          try { await facesApi.delete(face.id) } catch {}
        }
      }
      onUpdate()
      onClose()
    } catch {}
    setClearingAll(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.72)' }}
      onClick={onClose}>
      <div className="rounded-xl p-4 w-full max-w-md max-h-[90dvh] flex flex-col"
        style={{ background: '#1A1A1A', border: '1px solid #3A3A3A' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-start justify-between mb-3 shrink-0">
          <div className="flex-1 min-w-0">
            {renamingGroup ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={groupNameInput}
                  onChange={e => setGroupNameInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRenameGroup()
                    if (e.key === 'Escape') { setGroupNameInput(group.name); setRenamingGroup(false) }
                  }}
                  className="bg-[#3A3A3A] border border-[#A855F7] rounded px-2 py-0.5 text-sm text-white focus:outline-none w-40"
                />
                <button onClick={handleRenameGroup} disabled={renamingSaving}
                  className="text-xs disabled:opacity-50" style={{ color: '#A855F7' }}>
                  {renamingSaving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => { setGroupNameInput(group.name); setRenamingGroup(false) }}
                  className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h3 className="text-white font-semibold">{group.name}</h3>
                {!isUnknown && (
                  <button onClick={() => setRenamingGroup(true)}
                    className="text-gray-600 hover:text-gray-400 transition-colors text-sm leading-none"
                    title="Rename">✎</button>
                )}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-0.5">{group.faces.length} sample{group.faces.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none ml-4 shrink-0">✕</button>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className="grid grid-cols-3 gap-2">
            {group.faces.map(face => (
              <div key={face.id} className="rounded-lg overflow-hidden" style={{ background: '#2A2A2A', border: '1px solid #3A3A3A' }}>
                <div className="aspect-square"><FaceThumb faceId={face.id} /></div>
                <div className="p-1.5 space-y-1">
                  <p className="text-[10px] text-gray-500">{new Date(face.created_at).toLocaleDateString()}</p>
                  {isUnknown ? (
                    assigningId === face.id ? (
                      assignMode === 'new' ? (
                        <div className="flex gap-1">
                          <input
                            autoFocus
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && newName.trim()) handleAssign(face.id, newName.trim())
                              if (e.key === 'Escape') { setAssigningId(null); setAssignMode('select'); setNewName('') }
                            }}
                            placeholder="Name…"
                            className="flex-1 min-w-0 text-[10px] rounded px-1 py-0.5 focus:outline-none"
                            style={{ background: '#3A3A3A', border: '1px solid #A855F7', color: '#fff' }}
                          />
                          <button onClick={() => newName.trim() && handleAssign(face.id, newName.trim())}
                            disabled={!newName.trim()}
                            className="text-[10px] px-1 rounded disabled:opacity-30"
                            style={{ background: '#A855F7', color: '#fff' }}>✓</button>
                        </div>
                      ) : (
                        <select
                          className="w-full text-[10px] rounded px-1 py-0.5 focus:outline-none"
                          style={{ background: '#3A3A3A', border: '1px solid #555', color: '#E5E7EB' }}
                          defaultValue=""
                          onChange={e => {
                            if (e.target.value === '__new__') setAssignMode('new')
                            else if (e.target.value) handleAssign(face.id, e.target.value)
                          }}
                        >
                          <option value="" disabled>Assign to…</option>
                          {knownNames.map(n => <option key={n} value={n}>{n}</option>)}
                          <option value="__new__">+ New person…</option>
                        </select>
                      )
                    ) : (
                      <div className="flex gap-1">
                        <button onClick={() => startAssigning(face.id)}
                          className="flex-1 text-[10px] py-0.5 rounded hover:opacity-80"
                          style={{ background: '#3A3A3A', color: '#A855F7' }}>
                          Assign
                        </button>
                        <button onClick={() => handleDelete(face.id)} disabled={deletingId === face.id}
                          className="flex-1 text-[10px] py-0.5 rounded disabled:opacity-50 hover:opacity-80"
                          style={{ background: '#3A3A3A', color: '#F87171' }}>
                          {deletingId === face.id ? '…' : 'Del'}
                        </button>
                      </div>
                    )
                  ) : (
                    <div className="flex gap-1">
                      <button onClick={() => handleDisassociate(face.id)}
                        className="flex-1 text-[10px] py-0.5 rounded hover:opacity-80"
                        style={{ background: '#3A3A3A', color: '#9CA3AF' }} title="Move back to Unknown">
                        Remove
                      </button>
                      <button onClick={() => handleDelete(face.id)} disabled={deletingId === face.id}
                        className="flex-1 text-[10px] py-0.5 rounded disabled:opacity-50 hover:opacity-80"
                        style={{ background: '#3A3A3A', color: '#F87171' }}>
                        {deletingId === face.id ? '…' : 'Del'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <button onClick={handleClearAll} disabled={clearingAll}
          className="mt-3 w-full text-xs py-1.5 rounded shrink-0 disabled:opacity-50 hover:opacity-80 transition-opacity"
          style={{ background: 'rgba(239,68,68,0.15)', color: '#F87171', border: '1px solid rgba(239,68,68,0.3)' }}>
          {clearingAll ? 'Deleting…' : `Delete All ${group.faces.length} Samples`}
        </button>
      </div>
    </div>
  )
}

function SystemSettingsCard({ allSettings, saveSetting, saving, saved }) {
  return (
    <Card title="System Settings">
      <SettingRow label="Timezone" hint="Sets the timezone for timestamps and the Linux system clock.">
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
    </Card>
  )
}

function ChangePasswordCard() {
  const { logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (next !== confirm) { setError('Passwords do not match'); return }
    if (next.length < 4) { setError('Password must be at least 4 characters'); return }
    setSaving(true)
    try {
      await systemApi.changePassword(current, next)
      setDone(true)
      setCurrent(''); setNext(''); setConfirm('')
      setTimeout(() => { setDone(false); logout() }, 2000)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to change password')
    } finally {
      setSaving(false)
    }
  }

  const fieldCls = "bg-[#3A3A3A] border border-[#484848] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none w-full"

  return (
    <Card title="Change Password">
      <form onSubmit={submit} className="space-y-3 max-w-sm">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Current password</label>
          <input type="password" value={current} onChange={e => setCurrent(e.target.value)}
            className={fieldCls} autoComplete="current-password" required />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">New password</label>
          <input type="password" value={next} onChange={e => setNext(e.target.value)}
            className={fieldCls} autoComplete="new-password" required />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Confirm new password</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            className={fieldCls} autoComplete="new-password" required />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {done && <p className="text-sm text-green-400">Password changed — logging out…</p>}
        <button
          type="submit"
          disabled={saving || done}
          className="px-4 py-1.5 rounded-md text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
          style={{ background: '#FFB800', color: '#151925' }}
        >
          {saving ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </Card>
  )
}

function StorageTab() {
  const [refreshKey, setRefreshKey] = useState(0)
  const triggerRefresh = useCallback(() => setRefreshKey(k => k + 1), [])
  return (
    <div className="space-y-6">
      <StorageLocationCard />
      <ExternalDevicesCard onDeviceChanged={triggerRefresh} />
      <StorageCard />
      <VideoClipsCard refreshKey={refreshKey} />
    </div>
  )
}

function VideoClipsCard({ refreshKey = 0 }) {
  const [s, setS] = useState(null)
  const [clipStorage, setClipStorage] = useState(null)
  const [saving, setSaving] = useState({})
  const [saved, setSaved] = useState({})
  const [purging, setPurging] = useState(false)
  const [purgeConfirm, setPurgeConfirm] = useState(false)
  const [purgeResult, setPurgeResult] = useState(null)

  const load = useCallback(() => {
    settings.getAll().then(r => setS(r.data)).catch(() => {})
    detectionsApi.clipsStorage().then(r => setClipStorage(r.data)).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  const save = async (key, value) => {
    setSaving(p => ({ ...p, [key]: true }))
    try {
      await settings.set(key, value)
      setS(p => ({ ...p, [key]: String(value) }))
      setSaved(p => ({ ...p, [key]: true }))
      setTimeout(() => setSaved(p => ({ ...p, [key]: false })), 2000)
    } catch {}
    setSaving(p => ({ ...p, [key]: false }))
  }

  const handlePurgeClips = async () => {
    if (!purgeConfirm) { setPurgeConfirm(true); return }
    setPurging(true)
    setPurgeConfirm(false)
    setPurgeResult(null)
    try {
      const r = await detectionsApi.purgeClips()
      setPurgeResult(r.data.deleted_clips)
      load()
    } catch {}
    setPurging(false)
  }

  if (!s) return null

  const clipsEnabled = s.clips_enabled === '1'
  const preRoll = s.clips_pre_roll ?? '5'
  const postRoll = s.clips_post_roll ?? '10'
  const purgeMode = s.clips_purge_mode ?? 'pct'
  const threshold = s.clips_purge_threshold ?? '90'

  return (
    <Card title="Video Clips">
      <p className="text-xs text-gray-500 mb-4">
        Records MP4 clips of detection events. Requires an external USB drive — clips are never saved to internal storage.
      </p>

      {/* Enable toggle */}
      <div className="flex items-center justify-between py-3 border-b border-[#3A3A3A]">
        <div>
          <p className="text-sm font-medium text-white">Enable clip recording</p>
          <p className="text-xs text-gray-500 mt-0.5">Records a 640×360 MP4 with pre-roll for each detection event</p>
        </div>
        <button
          onClick={() => save('clips_enabled', clipsEnabled ? '0' : '1')}
          className="relative w-11 h-6 rounded-full transition-colors shrink-0"
          style={{ background: clipsEnabled ? '#FFB800' : '#3A3A3A' }}
        >
          <span
            className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all"
            style={{ left: clipsEnabled ? '1.375rem' : '0.25rem' }}
          />
        </button>
      </div>

      <div className={clipsEnabled ? '' : 'opacity-40 pointer-events-none select-none'}>
        {/* Pre-roll */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 py-3 border-b border-[#3A3A3A]">
          <div className="sm:w-40 shrink-0">
            <p className="text-sm font-medium text-white">Pre-roll</p>
            <p className="text-xs text-gray-500 mt-0.5">Seconds of footage before the event</p>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {['3', '5', '10', '15'].map(v => (
              <button key={v}
                onClick={() => save('clips_pre_roll', v)}
                className="px-3 py-1 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
                style={preRoll === v ? { background: '#FFB800', color: '#151925' } : { background: '#3A3A3A', color: '#9CA3AF' }}
              >{v}s</button>
            ))}
            {saved.clips_pre_roll && <span className="text-xs text-green-400 self-center">Saved ✓</span>}
          </div>
        </div>

        {/* Post-roll */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 py-3 border-b border-[#3A3A3A]">
          <div className="sm:w-40 shrink-0">
            <p className="text-sm font-medium text-white">Post-roll</p>
            <p className="text-xs text-gray-500 mt-0.5">Seconds to keep recording after detection ends</p>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {['5', '10', '15', '30'].map(v => (
              <button key={v}
                onClick={() => save('clips_post_roll', v)}
                className="px-3 py-1 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
                style={postRoll === v ? { background: '#FFB800', color: '#151925' } : { background: '#3A3A3A', color: '#9CA3AF' }}
              >{v}s</button>
            ))}
            {saved.clips_post_roll && <span className="text-xs text-green-400 self-center">Saved ✓</span>}
          </div>
        </div>

        {/* Auto-purge mode */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6 py-3 border-b border-[#3A3A3A]">
          <div className="sm:w-40 shrink-0">
            <p className="text-sm font-medium text-white">Auto-purge</p>
            <p className="text-xs text-gray-500 mt-0.5">Oldest clips deleted when threshold exceeded</p>
          </div>
          <div className="space-y-3">
            <div className="flex gap-2">
              {[
                { id: 'pct', label: 'Disk usage %' },
                { id: 'mb', label: 'Clip storage MB' },
              ].map(m => (
                <button key={m.id}
                  onClick={() => save('clips_purge_mode', m.id)}
                  className="px-3 py-1 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
                  style={purgeMode === m.id ? { background: '#FFB800', color: '#151925' } : { background: '#3A3A3A', color: '#9CA3AF' }}
                >{m.label}</button>
              ))}
              {saved.clips_purge_mode && <span className="text-xs text-green-400 self-center">Saved ✓</span>}
            </div>
            {purgeMode === 'pct' ? (
              <div className="flex gap-1.5 flex-wrap">
                <span className="text-xs text-gray-500 self-center">Purge when disk &gt;</span>
                {['70', '80', '90', '95'].map(v => (
                  <button key={v}
                    onClick={() => save('clips_purge_threshold', v)}
                    className="px-3 py-1 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
                    style={threshold === v ? { background: '#FFB800', color: '#151925' } : { background: '#3A3A3A', color: '#9CA3AF' }}
                  >{v}%</button>
                ))}
                {saved.clips_purge_threshold && <span className="text-xs text-green-400 self-center">Saved ✓</span>}
              </div>
            ) : (
              <div className="flex gap-1.5 flex-wrap">
                <span className="text-xs text-gray-500 self-center">Purge when clips exceed</span>
                {[
                  { label: '500 MB', value: '500' },
                  { label: '1 GB', value: '1024' },
                  { label: '5 GB', value: '5120' },
                  { label: '10 GB', value: '10240' },
                ].map(o => (
                  <button key={o.value}
                    onClick={() => save('clips_purge_threshold', o.value)}
                    className="px-3 py-1 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
                    style={threshold === o.value ? { background: '#FFB800', color: '#151925' } : { background: '#3A3A3A', color: '#9CA3AF' }}
                  >{o.label}</button>
                ))}
                {saved.clips_purge_threshold && <span className="text-xs text-green-400 self-center">Saved ✓</span>}
              </div>
            )}
          </div>
        </div>

        {/* Clip storage stats + manual purge */}
        <div className="pt-3">
          {clipStorage && clipStorage.disk_total > 0 && (
            <div className="mb-4 p-3 rounded-lg" style={{ background: '#222' }}>
              <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                <span className="font-medium text-white">Drive storage</span>
                <span>{fmtBytes(clipStorage.disk_used)} / {fmtBytes(clipStorage.disk_total)} · {fmtBytes(clipStorage.disk_free)} free</span>
              </div>
              <div className="relative w-full h-3 bg-[#3A3A3A] rounded-full overflow-hidden">
                {(() => {
                  const usedPct = clipStorage.disk_total ? (clipStorage.disk_used / clipStorage.disk_total) * 100 : 0
                  const clipsPct = clipStorage.disk_total ? (clipStorage.clip_bytes / clipStorage.disk_total) * 100 : 0
                  const otherPct = Math.max(0, usedPct - clipsPct)
                  const barColor = usedPct > 85 ? '#EF4444' : usedPct > 65 ? '#F59E0B' : '#4c6e5d'
                  return <>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${otherPct}%`, background: barColor, opacity: 0.4 }} />
                    <div className="absolute inset-y-0 rounded-full" style={{ left: `${otherPct}%`, width: `${clipsPct}%`, background: '#FFB800' }} />
                  </>
                })()}
              </div>
              <div className="flex gap-4 mt-1.5 text-xs text-gray-500">
                <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: '#FFB800' }} />{fmtBytes(clipStorage.clip_bytes)} clips ({clipStorage.clip_count})</span>
                <span><span className="inline-block w-2 h-2 rounded-full mr-1 opacity-40" style={{ background: '#4c6e5d' }} />other used</span>
              </div>
            </div>
          )}
          {clipStorage && !clipStorage.clips_dir && (
            <p className="text-xs text-yellow-500 mb-3">No drive set for videos — clips will not be saved. Tap "Use for Videos" on a mounted drive in the External Storage Devices card above.</p>
          )}
          {purgeResult !== null && (
            <p className="text-xs text-green-400 mb-2">{purgeResult} clip{purgeResult !== 1 ? 's' : ''} deleted.</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePurgeClips}
              disabled={purging || (clipStorage && clipStorage.clip_count === 0)}
              className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
              style={purgeConfirm
                ? { background: '#EF4444', color: '#fff' }
                : { background: '#3A3A3A', color: '#fff' }
              }
            >
              {purging ? 'Purging…' : purgeConfirm ? 'Confirm — delete all clips?' : 'Purge all clips'}
            </button>
            {purgeConfirm && (
              <button onClick={() => setPurgeConfirm(false)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

function UpdateCard() {
  const [status, setStatus] = useState(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installDone, setInstallDone] = useState(false)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)
  const checkRef = useRef(null)

  const check = useCallback(async () => {
    setChecking(true); setError(null)
    try {
      const r = await systemApi.updateStatus()
      setStatus(r.data)
      return r.data
    } catch { setError('Could not reach update service'); return null }
    finally { setChecking(false) }
  }, [])

  useEffect(() => { checkRef.current = check }, [check])

  // After a restart, poll until service responds (up to 60s), then refresh status.
  const waitForRestart = useCallback(() => {
    setInstallDone(true)
    let attempts = 0
    const t = setInterval(async () => {
      attempts++
      try {
        const r = await systemApi.updateStatus()
        clearInterval(t)
        setInstallDone(false)
        setStatus(r.data)
        setError(null)
      } catch {
        if (attempts >= 20) {
          clearInterval(t)
          setInstallDone(false)
          setError('Service did not come back after restart — check the device manually')
        }
      }
    }, 3000)
  }, [])

  // beginPoll starts the interval. alreadyInProgress=true skips waiting for
  // update_in_progress to become true first (used when resuming after a page refresh).
  const beginPoll = useCallback((alreadyInProgress = false) => {
    if (pollRef.current) return
    setInstalling(true)
    const start = Date.now()
    let seenInProgress = alreadyInProgress
    pollRef.current = setInterval(async () => {
      if (Date.now() - start > 360000) {
        clearInterval(pollRef.current); pollRef.current = null; setInstalling(false)
        setError('Update timed out — check service manually')
        return
      }
      try {
        const r = await systemApi.updateStatus()
        const s = r.data
        setStatus(s)
        if (s.update_in_progress) { seenInProgress = true; return }
        if (!seenInProgress) return
        clearInterval(pollRef.current); pollRef.current = null; setInstalling(false)
        if (s.last_result === 'success' || s.last_result == null) {
          waitForRestart()
        } else {
          setError(
            s.last_result === 'no_release' ? 'No release found' :
            s.last_result?.startsWith('error:') ? s.last_result.slice(6).trim() :
            s.last_result
          )
        }
      } catch {
        // Network error = service restarting after successful update
        clearInterval(pollRef.current); pollRef.current = null; setInstalling(false)
        waitForRestart()
      }
    }, 3000)
  }, [waitForRestart])

  useEffect(() => {
    check().then(data => {
      // If an update was already running when the page loaded, resume polling
      if (data?.update_in_progress) beginPoll(true)
    })
  }, [check, beginPoll])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const saveUpdateSettings = async (patch) => {
    try {
      await systemApi.saveUpdateSettings(patch)
      setStatus(s => ({
        ...s,
        ...(patch.channel !== undefined ? { channel: patch.channel } : {}),
        ...(patch.auto_update_enabled !== undefined ? { auto_update_enabled: patch.auto_update_enabled } : {}),
      }))
    } catch {}
  }

  const install = async () => {
    setError(null)
    try {
      await systemApi.update()
      beginPoll(true)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Update failed')
    }
  }

  const fmtDate = (iso) => {
    if (!iso) return null
    try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) }
    catch { return iso }
  }

  return (
    <Card title="Application Updates">
      {!status ? (
        <p className="text-sm text-gray-500">{checking ? 'Checking…' : 'Loading…'}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Current version</span>
            <div className="text-right">
              <span className="text-sm text-white font-mono">{status.current_version}</span>
              {status.last_updated && (
                <p className="text-xs text-gray-500 mt-0.5">Updated {fmtDate(status.last_updated)}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Latest available</span>
            <div className="text-right">
              {status.latest_version ? (
                <>
                  <span className={`text-sm font-mono ${status.update_available ? 'text-[#FFB800]' : 'text-white'}`}>
                    {status.latest_version}
                  </span>
                  {status.release_date && (
                    <p className="text-xs text-gray-500 mt-0.5">{fmtDate(status.release_date)}</p>
                  )}
                </>
              ) : (
                <span className="text-sm text-gray-500">—</span>
              )}
            </div>
          </div>

          {installing && !installDone && (
            <div className="px-3 py-2 rounded-lg text-sm" style={{ background: 'rgba(59,130,246,0.08)', color: '#60A5FA', border: '1px solid rgba(59,130,246,0.2)' }}>
              <p className="font-medium">Update in progress — do not click again.</p>
              <p className="text-xs opacity-70 mt-0.5">Takes 2–4 minutes while the frontend rebuilds. The service will restart automatically when done.</p>
            </div>
          )}
          {!installing && status.update_available && !installDone && (
            <div className="px-3 py-2 rounded-lg text-sm" style={{ background: 'rgba(255,184,0,0.08)', color: '#FFB800', border: '1px solid rgba(255,184,0,0.2)' }}>
              Update available
            </div>
          )}
          {installDone && (
            <div className="px-3 py-2 rounded-lg text-sm bg-green-500/10 text-green-400">
              ✓ Update installed — service restarting…
            </div>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={check}
              disabled={checking || installing}
              className="px-3 py-1.5 text-sm rounded-md disabled:opacity-40 hover:opacity-80 transition-opacity"
              style={{ background: '#3A3A3A', color: '#9CA3AF' }}
            >
              {checking ? 'Checking…' : 'Check for updates'}
            </button>
            {(status.update_available || status.update_in_progress) && !installing && (
              <button
                onClick={install}
                disabled={installing}
                className="px-3 py-1.5 text-sm rounded-md font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
                style={{ background: '#FFB800', color: '#151925' }}
              >
                Install update
              </button>
            )}
          </div>

          <div className="pt-2 border-t border-[#2E2E2E] space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-white">Update channel</p>
                <p className="text-xs text-gray-500 mt-0.5">Releases are tested and stable; main has the latest changes</p>
              </div>
              <select
                value={status.channel}
                onChange={e => saveUpdateSettings({ channel: e.target.value })}
                className="bg-[#3A3A3A] border border-[#484848] rounded-md px-2 py-1 text-sm text-white focus:outline-none shrink-0"
              >
                <option value="releases">Stable releases</option>
                <option value="main">Main branch</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-white">Auto-update</p>
                <p className="text-xs text-gray-500 mt-0.5">Checks daily at 3 AM — installs automatically if an update is found</p>
              </div>
              <button
                onClick={() => saveUpdateSettings({ auto_update_enabled: !status.auto_update_enabled })}
                className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
                style={{ background: status.auto_update_enabled ? '#FFB800' : '#3A3A3A' }}
              >
                <span
                  className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  style={{ transform: status.auto_update_enabled ? 'translateX(1.4rem)' : 'translateX(0.2rem)' }}
                />
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function SystemTab({ allSettings, saveSetting, saving, saved }) {
  return (
    <div className="space-y-6">
      <SystemStatsCard />
      <SystemSettingsCard allSettings={allSettings} saveSetting={saveSetting} saving={saving} saved={saved} />
      <ChangePasswordCard />
      <UpdateCard />
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

const REFRESH_OPTIONS = [
  { label: '1 second',  value: 1000 },
  { label: '3 seconds', value: 3000 },
  { label: '5 seconds', value: 5000 },
  { label: '10 seconds', value: 10000 },
  { label: '15 seconds', value: 15000 },
  { label: '30 seconds', value: 30000 },
]

function SystemStatsCard() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshInterval, setRefreshInterval] = useState(5000)

  const load = useCallback(() => {
    systemApi.stats()
      .then(r => { setStats(r.data); setError(null) })
      .catch(e => setError(e.response?.data?.detail || 'Failed to load system stats'))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const iv = setInterval(load, refreshInterval)
    return () => clearInterval(iv)
  }, [autoRefresh, refreshInterval, load])

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
          <div className="flex items-center gap-4 flex-wrap">
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
              <span className="text-xs" style={{ color: '#6B7280' }}>Auto-refresh</span>
            </label>
            <select
              value={refreshInterval}
              onChange={e => setRefreshInterval(Number(e.target.value))}
              disabled={!autoRefresh}
              className="bg-[#3A3A3A] border border-[#484848] rounded px-2 py-1 text-xs text-white focus:outline-none disabled:opacity-40"
              onFocus={e => e.target.style.borderColor = '#4c6e5d'}
              onBlur={e => e.target.style.borderColor = '#484848'}
            >
              {REFRESH_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
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

function ExternalDevicesCard({ onDeviceChanged }) {
  const [devices, setDevices] = useState([])
  const [primary, setPrimary] = useState(null)
  const [clipsPrimary, setClipsPrimary] = useState(null)
  const [pending, setPending] = useState({})
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState(null)
  const [scanning, setScanning] = useState(false)

  const load = useCallback(() => {
    storageApi.devices()
      .then(r => {
        setDevices(r.data.devices || [])
        setPrimary(r.data.primary)
        setClipsPrimary(r.data.clips_primary)
        setError(null)
      })
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
      else if (action === 'set-clips-primary') await storageApi.setClipsPrimary(device)
      load()
      if (action === 'set-primary' || action === 'set-clips-primary' || action === 'unmount') onDeviceChanged?.()
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
            const isClipsPrimary = dev.name === clipsPrimary
            return (
              <div key={dev.name} className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 border-b border-[#3A3A3A] last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono text-white">/dev/{dev.name}</span>
                    <span className="text-xs text-gray-500">{dev.size}</span>
                    {dev.label && <span className="text-xs text-gray-400">"{dev.label}"</span>}
                    {dev.fstype && <span className="text-xs text-gray-600">{dev.fstype}</span>}
                    {isPrimary && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,184,0,0.15)', color: '#FFB800' }}>Images</span>}
                    {isClipsPrimary && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.15)', color: '#818CF8' }}>Videos</span>}
                    {mounted && !isPrimary && !isClipsPrimary && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#4ADE80' }}>Mounted</span>}
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
                  {mounted && !isClipsPrimary && (
                    <button
                      onClick={() => act(dev.name, 'set-clips-primary', 'Set Clips Primary')}
                      disabled={!!pending[`${dev.name}-set-clips-primary`]}
                      className="px-3 py-1 text-xs rounded-md disabled:opacity-50 transition-colors"
                      style={{ background: 'rgba(99,102,241,0.15)', color: '#818CF8' }}
                    >
                      {pending[`${dev.name}-set-clips-primary`] ? 'Setting…' : 'Use for Videos'}
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

const PURGE_CATEGORIES = ['all', 'people', 'faces', 'vehicles', 'animals', 'other']
const CATEGORY_STYLE = {
  people:   { background: 'rgba(239,68,68,0.15)',   color: '#F87171' },
  vehicles: { background: 'rgba(59,130,246,0.15)',  color: '#60A5FA' },
  animals:  { background: 'rgba(34,197,94,0.15)',   color: '#4ADE80' },
  faces:    { background: 'rgba(168,85,247,0.15)',  color: '#C084FC' },
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

function ModelSelector({ allSettings, onSave, saving, saved, errors }) {
  const activeKey = allSettings.detection_model ?? allSettings.yolo_model ?? 'yolov8n'
  const activeModel = DETECTION_MODELS.find(m => m.key === activeKey) ?? DETECTION_MODELS[0]
  const [availability, setAvailability] = useState({})

  const [classesVal, setClassesVal] = useState(() =>
    allSettings.detection_classes ?? (activeModel.openVocab ? DEFAULT_WILDLIFE_CLASSES : '')
  )

  useEffect(() => {
    settings.getModels()
      .then(r => {
        const map = {}
        ;(r.data || []).forEach(m => { map[m.key] = m.available !== false })
        setAvailability(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setClassesVal(allSettings.detection_classes ?? (activeModel.openVocab ? DEFAULT_WILDLIFE_CLASSES : ''))
  }, [activeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const isBusy = saving.detection_model || saving.detection_classes

  return (
    <div className="space-y-2">
      {DETECTION_MODELS.map(m => {
        const isActive = activeKey === m.key
        const isAvailable = availability[m.key] !== false
        return (
          <button
            key={m.key}
            onClick={() => isAvailable && onSave('detection_model', m.key)}
            disabled={isBusy || !isAvailable}
            className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-all hover:opacity-90"
            style={
              !isAvailable
                ? { background: '#1C1C1C', border: '1px solid #2A2A2A', opacity: 0.45, cursor: 'not-allowed' }
                : isActive
                  ? { background: 'rgba(255,184,0,0.10)', border: '1px solid rgba(255,184,0,0.6)' }
                  : { background: '#242424', border: '1px solid #3A3A3A' }
            }
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium" style={{ color: isActive ? '#FFB800' : '#fff' }}>
                  {m.name}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={SPEED_STYLE[m.speed]}>
                  {m.speed}
                </span>
                {!isAvailable && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full"
                    style={{ background: 'rgba(239,68,68,0.12)', color: '#F87171' }}>
                    x86-64 only
                  </span>
                )}
                {isAvailable && m.requiresInstall && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full"
                    style={{ background: 'rgba(156,163,175,0.12)', color: '#6B7280' }}>
                    Extra install
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5 leading-relaxed" style={{ color: isActive ? '#9CA3AF' : '#6B7280' }}>
                {m.description}
              </p>
            </div>
            <div
              className="w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 transition-all"
              style={isActive
                ? { borderColor: '#FFB800', background: '#FFB800' }
                : { borderColor: '#4B5563', background: 'transparent' }
              }
            >
              {isActive && <div className="w-1.5 h-1.5 rounded-full bg-[#151925]" />}
            </div>
          </button>
        )
      })}

      {saving.detection_model && (
        <p className="text-xs text-yellow-400 pt-1">Loading model — this may take a minute on first use…</p>
      )}
      {saved.detection_model && !saving.detection_model && (
        <p className="text-xs text-green-400 pt-1">Model loaded ✓</p>
      )}
      {errors?.detection_model && !saving.detection_model && (
        <p className="text-xs text-red-400 pt-1">{errors.detection_model}</p>
      )}

      {activeModel.openVocab && (
        <div className="mt-3 pt-3 border-t border-[#3A3A3A]">
          <label className="block text-xs text-gray-500 mb-1.5">
            Detection classes <span className="text-gray-600">(comma-separated — these are what the model looks for)</span>
          </label>
          <textarea
            value={classesVal}
            onChange={e => setClassesVal(e.target.value)}
            rows={3}
            className="w-full rounded-md px-3 py-2 text-sm text-white focus:outline-none resize-none"
            style={{ background: '#2A2A2A', border: '1px solid #484848' }}
            placeholder="deer, moose, elk, bear, mountain lion, cat, dog, bird, person…"
          />
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <button
              onClick={() => onSave('detection_classes', classesVal)}
              disabled={saving.detection_classes}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: '#FFB800', color: '#151925' }}
            >
              {saving.detection_classes ? 'Applying…' : saved.detection_classes ? 'Applied ✓' : 'Apply Classes'}
            </button>
            <button
              onClick={() => {
                setClassesVal(DEFAULT_WILDLIFE_CLASSES)
                onSave('detection_classes', DEFAULT_WILDLIFE_CLASSES)
              }}
              disabled={saving.detection_classes}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: '#3A3A3A', color: '#9CA3AF' }}
            >
              Reset to Default
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const CONF_OBJECT_CATEGORIES = [
  { key: 'confidence_people',   label: 'People',   color: '#F87171' },
  { key: 'confidence_vehicles', label: 'Vehicles', color: '#60A5FA' },
  { key: 'confidence_animals',  label: 'Animals',  color: '#4ADE80' },
  { key: 'confidence_other',    label: 'Other',    color: '#FCD34D' },
]
const CONF_FACE_CATEGORY = { key: 'confidence_faces', label: 'Faces', color: '#A855F7' }
const CONF_CATEGORIES = [...CONF_OBJECT_CATEGORIES, CONF_FACE_CATEGORY]

function ConfidenceSliders({ allSettings, onSave, saving, saved }) {
  const [vals, setVals] = useState(() =>
    Object.fromEntries(CONF_CATEGORIES.map(c => [c.key, parseFloat(allSettings[c.key] ?? 0.5)]))
  )
  useEffect(() => {
    setVals(Object.fromEntries(CONF_CATEGORIES.map(c => [c.key, parseFloat(allSettings[c.key] ?? 0.5)])))
  }, [allSettings])

  const renderSlider = ({ key, label, color }) => {
    const enabledKey = `category_enabled_${key.replace('confidence_', '')}`
    const defaultEnabled = key === 'confidence_faces' ? '0' : '1'
    const enabled = (allSettings[enabledKey] ?? defaultEnabled) !== '0'
    return (
      <div key={key} className="flex items-center gap-3">
        <span className="text-xs font-medium w-16 shrink-0" style={{ color: enabled ? color : '#555' }}>{label}</span>
        <button
          onClick={() => onSave(enabledKey, enabled ? '0' : '1')}
          className="shrink-0 relative w-8 h-4 rounded-full transition-colors"
          style={{ background: enabled ? color : '#3A3A3A' }}
          title={enabled ? 'Disable category' : 'Enable category'}
        >
          <span
            className="absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all duration-200"
            style={enabled ? { right: '2px' } : { left: '2px' }}
          />
        </button>
        <input
          type="range"
          min={0.05} max={0.95} step={0.05}
          value={vals[key]}
          onChange={e => { if (enabled) setVals(v => ({ ...v, [key]: parseFloat(e.target.value) })) }}
          onMouseUp={e => { if (enabled) onSave(key, parseFloat(e.target.value)) }}
          onTouchEnd={() => { if (enabled) onSave(key, vals[key]) }}
          disabled={!enabled}
          className="flex-1 cursor-pointer transition-opacity"
          style={{ opacity: enabled ? 1 : 0.25, accentColor: '#FFB800', pointerEvents: enabled ? 'auto' : 'none' }}
        />
        <span className="text-xs font-mono w-9 text-right shrink-0 transition-opacity"
          style={{ color: enabled ? '#D1D5DB' : '#555', opacity: enabled ? 1 : 0.4 }}>
          {Math.round(vals[key] * 100)}%
        </span>
        {(saving[key] || saving[enabledKey]) && <span className="text-xs text-gray-500 shrink-0">…</span>}
        {(saved[key] || saved[enabledKey]) && !saving[key] && !saving[enabledKey] && <span className="text-xs text-green-400 shrink-0">✓</span>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {CONF_OBJECT_CATEGORIES.map(renderSlider)}

      <div className="pt-2 mt-1 border-t border-[#3A3A3A]">
        <p className="text-xs text-gray-500 mb-2.5">
          Face detection runs alongside YOLO and shares CPU resources. For best results on smaller ARM processors, run faces <span className="text-gray-300">on its own</span> with other categories disabled.
        </p>
        {renderSlider(CONF_FACE_CATEGORY)}
      </div>
    </div>
  )
}

function TextInput({ keyName, current, onSave, saving, saved, error, placeholder, secret }) {
  const [val, setVal] = useState(current)
  const dirty = val !== current && val !== ''
  const canSave = !saving && !!val
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          type={secret ? 'password' : 'text'}
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && canSave) onSave(keyName, val) }}
          placeholder={placeholder}
          className={`${inputCls} w-full sm:w-64`}
          onFocus={e => e.target.style.borderColor = '#151925'}
          onBlur={e => e.target.style.borderColor = '#484848'}
        />
        <button
          onClick={() => onSave(keyName, val)}
          disabled={!canSave}
          className="px-3 py-1.5 disabled:opacity-40 text-white text-sm rounded-md transition-opacity hover:opacity-90"
          style={{ background: '#FFB800', color: '#151925' }}
        >
          {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
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
