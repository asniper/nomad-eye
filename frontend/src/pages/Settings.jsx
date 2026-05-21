import { useEffect, useState } from 'react'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { settings, status, auth } from '../api/client'
import { useAuth } from '../hooks/useAuth'

const STATUS_OPTIONS = ['home', 'away', 'sleep', 'vacation']
const STATUS_COLOR = { home: 'green', away: 'yellow', sleep: 'blue', vacation: 'red' }

function SettingRow({ label, hint, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6 py-4 border-b border-gray-800 last:border-0">
      <div className="sm:w-48 shrink-0">
        <p className="text-sm font-medium text-white">{label}</p>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

export default function Settings() {
  const { logout } = useAuth()
  const [deviceStatus, setDeviceStatus] = useState('home')
  const [allSettings, setAllSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [saved, setSaved] = useState({})

  useEffect(() => {
    Promise.all([
      status.get().then(r => setDeviceStatus(r.data.status)).catch(() => {}),
      settings.getAll().then(r => setAllSettings(r.data || {})).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  const saveSetting = async (key, value) => {
    setSaving(s => ({ ...s, [key]: true }))
    try {
      await settings.set(key, value)
      setAllSettings(s => ({ ...s, [key]: value }))
      setSaved(s => ({ ...s, [key]: true }))
      setTimeout(() => setSaved(s => ({ ...s, [key]: false })), 2000)
    } catch {}
    setSaving(s => ({ ...s, [key]: false }))
  }

  const changeStatus = async (s) => {
    setDeviceStatus(s)
    await status.set(s).catch(() => {})
  }

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Settings</h2>

      <Card title="Device Status">
        <p className="text-sm text-gray-400 mb-3">
          The current status controls which notification rules are active.
        </p>
        <div className="flex gap-2 flex-wrap">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => changeStatus(s)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                deviceStatus === s
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
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
        <SettingRow label="Confidence threshold" hint="0.0–1.0. Higher = fewer false positives.">
          <NumberInput
            keyName="detection_confidence"
            current={allSettings.detection_confidence ?? 0.5}
            min={0.1} max={1.0} step={0.05}
            onSave={saveSetting}
            saving={saving.detection_confidence}
            saved={saved.detection_confidence}
          />
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

      <Card title="SMS (Twilio)">
        <SettingRow label="Account SID">
          <TextInput keyName="twilio_account_sid" current={allSettings.twilio_account_sid ?? ''} onSave={saveSetting} saving={saving.twilio_account_sid} saved={saved.twilio_account_sid} placeholder="ACxxxxxxxxxxxxxxxx" />
        </SettingRow>
        <SettingRow label="Auth Token">
          <TextInput keyName="twilio_auth_token" current={allSettings.twilio_auth_token ?? ''} onSave={saveSetting} saving={saving.twilio_auth_token} saved={saved.twilio_auth_token} placeholder="••••••••" secret />
        </SettingRow>
        <SettingRow label="From Number">
          <TextInput keyName="twilio_from_number" current={allSettings.twilio_from_number ?? ''} onSave={saveSetting} saving={saving.twilio_from_number} saved={saved.twilio_from_number} placeholder="+1234567890" />
        </SettingRow>
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
        className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 w-64"
      />
      <button
        onClick={() => onSave(keyName, val)}
        disabled={saving || (!val && !dirty)}
        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm rounded-md transition-colors"
      >
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
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
        className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 w-28"
      />
      <button
        onClick={() => onSave(keyName, val)}
        disabled={saving}
        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm rounded-md transition-colors"
      >
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
      </button>
    </div>
  )
}
