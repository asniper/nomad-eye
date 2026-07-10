import { useEffect, useState } from 'react'
import Card from './Card'
import { settings } from '../api/client'

// Notification transport / provider configuration (SMS, Email, ntfy, link mode).
// Self-contained — owns its own settings state so it can drop onto the
// Notifications page without threading anything through. Render only for admins
// (settings.get/set are admin-only server-side regardless, but this keeps the UI
// honest so operators/viewers don't see cred forms that would just 403).

const inputCls = "bg-[#3A3A3A] border border-[#484848] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none transition-colors"

const LINK_MODES = [
  { value: 'local_ip',  label: 'Local IP',     hint: 'Auto-detected LAN IP (e.g. http://192.168.0.165)' },
  { value: 'hostname',  label: 'Device Name',  hint: 'Custom hostname you configure below' },
  { value: 'tailscale', label: 'Tailscale IP', hint: 'Tailscale mesh IP — works outside your local network' },
]

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

function TextInput({ keyName, current, onSave, saving, saved, error, placeholder, secret }) {
  const [val, setVal] = useState(current)
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

function NotificationLinksCard({ allSettings, saveSetting, saving, saved, errors }) {
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const mode = allSettings.notification_link_mode || 'local_ip'

  const fetchPreview = () => {
    setPreviewLoading(true)
    settings.getNotificationUrl()
      .then(r => setPreviewUrl(r.data?.url || null))
      .catch(() => setPreviewUrl(null))
      .finally(() => setPreviewLoading(false))
  }

  return (
    <Card title="Notification Links">
      <SettingRow label="Link mode" hint="How the device URL is generated for links in notifications and alerts.">
        <div className="flex flex-col gap-2">
          {LINK_MODES.map(m => (
            <label key={m.value} className="flex items-start gap-3 cursor-pointer group">
              <div className="mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors"
                style={{ borderColor: mode === m.value ? '#FFB800' : '#484848', background: mode === m.value ? '#FFB800' : 'transparent' }}
                onClick={() => saveSetting('notification_link_mode', m.value)}
              >
                {mode === m.value && <div className="w-1.5 h-1.5 rounded-full bg-[#1A1A1A]" />}
              </div>
              <div onClick={() => saveSetting('notification_link_mode', m.value)}>
                <p className="text-sm text-white">{m.label}</p>
                <p className="text-xs text-gray-500">{m.hint}</p>
              </div>
            </label>
          ))}
        </div>
      </SettingRow>

      {mode === 'hostname' && (
        <SettingRow label="Hostname" hint="Hostname or IP to use in links. Can be a local hostname, domain, or IP.">
          <TextInput
            keyName="notification_hostname"
            current={allSettings.notification_hostname ?? ''}
            onSave={saveSetting}
            saving={saving.notification_hostname}
            saved={saved.notification_hostname}
            error={errors.notification_hostname}
            placeholder="nomadeye.local"
          />
        </SettingRow>
      )}

      <div className="pt-3 flex items-center gap-3">
        <button
          onClick={fetchPreview}
          disabled={previewLoading}
          className="px-3 py-1.5 bg-[#3A3A3A] hover:bg-[#484848] text-sm text-gray-300 rounded-md transition-colors disabled:opacity-50"
        >
          {previewLoading ? 'Checking…' : 'Preview current URL'}
        </button>
        {previewUrl && (
          <span className="text-sm font-mono text-gray-300">{previewUrl}</span>
        )}
      </div>
    </Card>
  )
}

export default function NotificationSettings() {
  const [allSettings, setAllSettings] = useState({})
  const [saving, setSaving] = useState({})
  const [saved, setSaved] = useState({})
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    settings.getAll()
      .then(r => setAllSettings(r.data || {}))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const saveSetting = async (key, value) => {
    setSaving(s => ({ ...s, [key]: true }))
    setErrors(s => ({ ...s, [key]: null }))
    try {
      await settings.set(key, value)
      setAllSettings(s => ({ ...s, [key]: value }))
      setSaved(s => ({ ...s, [key]: true }))
      setTimeout(() => setSaved(s => ({ ...s, [key]: false })), 2000)
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Failed to save — check device logs.'
      setErrors(s => ({ ...s, [key]: msg }))
    }
    setSaving(s => ({ ...s, [key]: false }))
  }

  if (loading) return <div className="text-gray-500 text-sm">Loading notification settings…</div>

  return (
    <div className="space-y-6">
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

      <Card title="ntfy Push Notifications">
        <div className="flex items-center justify-between py-3 mb-2 border-b border-[#3A3A3A]">
          <div>
            <p className="text-sm font-medium text-white">Enable ntfy notifications</p>
            <p className="text-xs text-gray-500 mt-0.5">Globally pause all ntfy alerts without removing contacts or rules.</p>
          </div>
          <button
            onClick={() => saveSetting('ntfy_enabled', (allSettings.ntfy_enabled ?? '1') === '0' ? '1' : '0')}
            className="relative w-11 h-6 rounded-full transition-colors shrink-0"
            style={{ background: (allSettings.ntfy_enabled ?? '1') !== '0' ? '#FFB800' : '#3A3A3A' }}
          >
            <span
              className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all"
              style={{ left: (allSettings.ntfy_enabled ?? '1') !== '0' ? '1.375rem' : '0.25rem' }}
            />
          </button>
        </div>
        <div className={(allSettings.ntfy_enabled ?? '1') === '0' ? 'opacity-40 pointer-events-none select-none' : ''}>
          <SettingRow label="Server URL" hint="ntfy.sh (cloud, free) or your self-hosted ntfy server URL.">
            <TextInput keyName="ntfy_server" current={allSettings.ntfy_server ?? 'https://ntfy.sh'} onSave={saveSetting} saving={saving.ntfy_server} saved={saved.ntfy_server} error={errors.ntfy_server} placeholder="https://ntfy.sh" />
          </SettingRow>
          <SettingRow label="Access Token" hint="Optional. Required only for private topics or authenticated self-hosted servers.">
            <TextInput keyName="ntfy_token" current={allSettings.ntfy_token ?? ''} onSave={saveSetting} saving={saving.ntfy_token} saved={saved.ntfy_token} error={errors.ntfy_token} placeholder="tk_..." secret />
          </SettingRow>
          <SettingRow label="Send images" hint="Attach the detection snapshot to each ntfy notification. Disable for privacy on public topics.">
            <button
              onClick={() => saveSetting('ntfy_send_images', (allSettings.ntfy_send_images ?? '1') === '0' ? '1' : '0')}
              className="relative w-11 h-6 rounded-full transition-colors shrink-0"
              style={{ background: (allSettings.ntfy_send_images ?? '1') !== '0' ? '#FFB800' : '#3A3A3A' }}
            >
              <span
                className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all"
                style={{ left: (allSettings.ntfy_send_images ?? '1') !== '0' ? '1.375rem' : '0.25rem' }}
              />
            </button>
          </SettingRow>
        </div>
        <div className="mt-4 pt-4 border-t border-[#3A3A3A]">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Setup Guide</p>
          <ol className="space-y-3">
            {[
              { n: 1, text: <span>Download the <strong className="text-white">ntfy</strong> app — search <span className="font-mono text-gray-300">ntfy</span> in the App Store (iOS) or Play Store (Android). Free and open source.</span> },
              { n: 2, text: <span>In the app, tap <strong className="text-white">+</strong> and subscribe to a topic name you choose — e.g. <span className="font-mono text-gray-300">my-home-alerts</span>. A topic is like a private channel; pick something unique so only you know it.</span> },
              { n: 3, text: <span>Go to <strong className="text-white">Contacts → Add Contact</strong> below, set type to <strong className="text-white">ntfy</strong>, and enter your topic name.</span> },
              { n: 4, text: <span>Add a <strong className="text-white">Notification Rule</strong> for that contact to control which detections trigger an alert and when.</span> },
            ].map(({ n, text }) => (
              <li key={n} className="flex items-start gap-2.5 text-sm text-gray-400">
                <span className="shrink-0 w-5 h-5 rounded-full bg-[#3A3A3A] text-xs text-gray-300 flex items-center justify-center mt-0.5">{n}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-gray-600 mt-3">No account needed for public topics on ntfy.sh. For private topics, create a free account at ntfy.sh and paste your access token above.</p>
        </div>
      </Card>

      <NotificationLinksCard allSettings={allSettings} saveSetting={saveSetting} saving={saving} saved={saved} errors={errors} />
    </div>
  )
}
