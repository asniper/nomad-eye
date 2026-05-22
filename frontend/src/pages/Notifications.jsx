import { useEffect, useCallback, useState } from 'react'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { notifications, settings as settingsApi } from '../api/client'
import { formatDateTime } from '../utils/dates'

const CATEGORIES = ['people', 'vehicles', 'animals', 'faces', 'other']
const STATUSES = ['home', 'away', 'sleep', 'vacation']

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
const CARRIERS = [
  { value: 'att',        label: 'AT&T' },
  { value: 'tmobile',    label: 'T-Mobile' },
  { value: 'verizon',    label: 'Verizon' },
  { value: 'sprint',     label: 'Sprint' },
  { value: 'boost',      label: 'Boost Mobile' },
  { value: 'cricket',    label: 'Cricket' },
  { value: 'us_cellular',label: 'US Cellular' },
  { value: 'metro',      label: 'Metro by T-Mobile' },
]

const inputCls = "bg-[#3A3A3A] border border-[#484848] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none transition-colors"

const TH = ({ children, right }) => (
  <th className={`pb-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider ${right ? 'text-right' : 'text-left'}`}>
    {children}
  </th>
)

function Toggle({ enabled, onChange }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className="relative shrink-0 rounded-full transition-colors duration-200 focus:outline-none"
      style={{ width: 34, height: 18, background: enabled ? '#FFB800' : '#484848' }}
    >
      <div
        className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all duration-200"
        style={{ left: enabled ? 16 : 2 }}
      />
    </button>
  )
}

function ContactForm({ onSave, onCancel, smsProvider }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('sms')
  const [value, setValue] = useState('')
  const [carrier, setCarrier] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const needsCarrier = type === 'sms' && smsProvider === 'email_gateway'

  const submit = async (e) => {
    e.preventDefault()
    if (needsCarrier && !carrier) { setError('Please select a carrier for Email Gateway SMS.'); return }
    setSaving(true)
    setError(null)
    try {
      const r = await notifications.createContact({ name, type, value, carrier: type === 'sms' ? carrier || null : null })
      onSave(r.data)
    } catch {
      setError('Failed to save contact.')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 mt-4 pt-4 border-t border-[#3A3A3A]">
      <h4 className="text-sm font-medium text-gray-300">New Contact</h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name"
          required
          className={inputCls}
          onFocus={e => e.target.style.borderColor = '#4c6e5d'}
          onBlur={e => e.target.style.borderColor = '#484848'}
        />
        <select
          value={type}
          onChange={e => { setType(e.target.value); setCarrier('') }}
          className={inputCls}
          onFocus={e => e.target.style.borderColor = '#4c6e5d'}
          onBlur={e => e.target.style.borderColor = '#484848'}
        >
          <option value="sms">SMS</option>
          <option value="email">Email</option>
        </select>
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={type === 'sms' ? '+1234567890' : 'email@example.com'}
          required
          className={inputCls}
          onFocus={e => e.target.style.borderColor = '#4c6e5d'}
          onBlur={e => e.target.style.borderColor = '#484848'}
        />
      </div>
      {type === 'sms' && (
        <div className="flex items-center gap-3">
          <select
            value={carrier}
            onChange={e => setCarrier(e.target.value)}
            required={needsCarrier}
            className={`${inputCls} w-full sm:w-56`}
            onFocus={e => e.target.style.borderColor = '#4c6e5d'}
            onBlur={e => e.target.style.borderColor = '#484848'}
          >
            <option value="">— Carrier (for Email Gateway) —</option>
            {CARRIERS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {needsCarrier && <span className="text-xs text-yellow-400">Required for Email Gateway</span>}
        </div>
      )}
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-1.5 text-white text-sm rounded-md transition-opacity disabled:opacity-50 hover:opacity-90"
          style={{ background: '#FFB800', color: '#151925' }}
        >
          {saving ? 'Saving...' : 'Add Contact'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-1.5 bg-[#484848] hover:bg-[#3A3A3A] text-white text-sm rounded-md transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

const FREQUENCIES = [
  { value: 'instant', label: 'Instant' },
  { value: '15min',   label: 'Every 15 min' },
  { value: '30min',   label: 'Every 30 min' },
  { value: 'hourly',  label: 'Hourly' },
  { value: 'daily',   label: 'Daily' },
]
const FREQUENCY_LABEL = Object.fromEntries(FREQUENCIES.map(f => [f.value, f.label]))

function RuleForm({ contacts, onSave, onCancel, initialValues, onUpdate }) {
  const isEdit = !!initialValues
  const [contactId, setContactId] = useState(initialValues?.contact_id ?? contacts[0]?.id ?? '')
  const [cats, setCats] = useState(initialValues?.categories ?? [])
  const [statuses, setStatuses] = useState(initialValues?.device_statuses ?? [])
  const [timeStart, setTimeStart] = useState(initialValues?.time_start ?? '')
  const [timeEnd, setTimeEnd] = useState(initialValues?.time_end ?? '')
  const [frequency, setFrequency] = useState(initialValues?.frequency ?? 'instant')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const toggle = (list, setter, val) =>
    setter(list.includes(val) ? list.filter(x => x !== val) : [...list, val])

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const data = {
      contact_id: parseInt(contactId),
      categories: cats.length ? cats : null,
      device_statuses: statuses.length ? statuses : null,
      time_start: timeStart || null,
      time_end: timeEnd || null,
      frequency,
    }
    try {
      if (isEdit) {
        const r = await notifications.updateRule(initialValues.id, data)
        onUpdate(r.data)
      } else {
        const r = await notifications.createRule(data)
        onSave(r.data)
      }
    } catch {
      setError('Failed to save rule.')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 mt-4 pt-4 border-t border-[#3A3A3A]">
      <h4 className="text-sm font-medium text-gray-300">{isEdit ? 'Edit Rule' : 'New Rule'}</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Contact</label>
          <select value={contactId} onChange={e => setContactId(e.target.value)} required className={inputCls}
            onFocus={e => e.target.style.borderColor = '#4c6e5d'} onBlur={e => e.target.style.borderColor = '#484848'}>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Frequency</label>
          <div className="flex gap-1.5 flex-wrap">
            {FREQUENCIES.map(f => (
              <button key={f.value} type="button" onClick={() => setFrequency(f.value)}
                className="px-2.5 py-1 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
                style={frequency === f.value ? { background: '#FFB800', color: '#151925' } : { background: '#3A3A3A', color: '#fff' }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Categories (empty = all)</label>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(c => (
            <button key={c} type="button" onClick={() => toggle(cats, setCats, c)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-opacity capitalize text-white hover:opacity-80"
              style={cats.includes(c) ? { background: '#FFB800', color: '#151925' } : { background: '#3A3A3A' }}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Device statuses (empty = all)</label>
        <div className="flex gap-2 flex-wrap">
          {STATUSES.map(s => (
            <button key={s} type="button" onClick={() => toggle(statuses, setStatuses, s)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-opacity capitalize text-white hover:opacity-80"
              style={statuses.includes(s) ? { background: '#FFB800', color: '#151925' } : { background: '#3A3A3A' }}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Time window (optional)</label>
        <div className="flex items-center gap-2">
          <input type="time" value={timeStart} onChange={e => setTimeStart(e.target.value)} className={inputCls}
            onFocus={e => e.target.style.borderColor = '#4c6e5d'} onBlur={e => e.target.style.borderColor = '#484848'} />
          <span className="text-gray-500 text-sm">to</span>
          <input type="time" value={timeEnd} onChange={e => setTimeEnd(e.target.value)} className={inputCls}
            onFocus={e => e.target.style.borderColor = '#4c6e5d'} onBlur={e => e.target.style.borderColor = '#484848'} />
        </div>
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-1.5 text-white text-sm rounded-md transition-opacity disabled:opacity-50 hover:opacity-90"
          style={{ background: '#FFB800', color: '#151925' }}>
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Rule'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-1.5 bg-[#484848] hover:bg-[#3A3A3A] text-white text-sm rounded-md transition-colors">
          Cancel
        </button>
      </div>
    </form>
  )
}

function NotificationLog() {
  const [log, setLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    notifications.log({ limit: 50 })
      .then(r => setLog(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const clearLog = async () => {
    setClearing(true)
    await notifications.clearLog().catch(() => {})
    setLog([])
    setClearing(false)
  }

  return (
    <Card title="Notification Log">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">Last 50 notifications sent</p>
        {log.length > 0 && (
          <button
            onClick={clearLog}
            disabled={clearing}
            className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
          >
            {clearing ? 'Clearing...' : 'Clear log'}
          </button>
        )}
      </div>
      {loading && <p className="text-gray-500 text-sm py-4 text-center">Loading...</p>}
      {!loading && log.length === 0 && (
        <p className="text-gray-500 text-sm py-4 text-center">No notifications sent yet.</p>
      )}
      <div className="divide-y divide-[#3A3A3A]">
        {log.map(entry => (
          <div key={entry.id} className="py-3 flex items-start gap-3">
            <div className="flex flex-col gap-1 shrink-0 pt-0.5">
              <Badge label={entry.channel} color={entry.channel === 'sms' ? 'green' : 'blue'} />
              <span
                className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium"
                style={entry.status === 'sent'
                  ? { background: 'rgba(34,197,94,0.15)', color: '#4ADE80' }
                  : { background: 'rgba(239,68,68,0.15)', color: '#F87171' }
                }
              >
                {entry.status}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-white">{entry.contact_name}</span>
                <span className="text-xs text-gray-500 truncate">{entry.address}</span>
              </div>
              {entry.message && (
                <pre className="text-xs text-gray-400 mt-1 whitespace-pre-wrap font-sans leading-relaxed bg-[#1E1E1E] rounded px-2.5 py-2">
                  {entry.message}
                </pre>
              )}
              {entry.error && (
                <p className="text-xs text-red-400 mt-0.5 truncate">{entry.error}</p>
              )}
              <p className="text-xs text-gray-600 mt-1">{formatDateTime(entry.timestamp)}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function Notifications() {
  const [contacts, setContacts] = useState([])
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [addingContact, setAddingContact] = useState(false)
  const [addingRule, setAddingRule] = useState(false)
  const [smsProvider, setSmsProvider] = useState('twilio')
  const [testState, setTestState] = useState({})

  useEffect(() => {
    settingsApi.getAll().then(r => setSmsProvider(r.data.sms_provider ?? 'twilio')).catch(() => {})
  }, [])

  const reload = useCallback(() => {
    setError(null)
    return Promise.all([
      notifications.listContacts().then(r => setContacts(r.data)),
      notifications.listRules().then(r => setRules(r.data)),
    ]).catch(() => setError('Failed to load notifications data.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  const addContact = (contact) => {
    setContacts(prev => [...prev, contact])
    setAddingContact(false)
  }

  const addRule = (rule) => {
    setRules(prev => [...prev, rule])
    setAddingRule(false)
  }

  const deleteContact = async (id) => {
    setContacts(prev => prev.filter(c => c.id !== id))
    await notifications.deleteContact(id).catch(() => reload())
  }

  const toggleContact = async (id, active) => {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, active } : c))
    await notifications.patchContact(id, { active }).catch(() => reload())
  }

  const testContact = async (id) => {
    setTestState(prev => ({ ...prev, [id]: 'sending' }))
    try {
      await notifications.testContact(id)
      setTestState(prev => ({ ...prev, [id]: 'ok' }))
      setTimeout(() => setTestState(prev => ({ ...prev, [id]: null })), 4000)
    } catch {
      setTestState(prev => ({ ...prev, [id]: 'error' }))
      setTimeout(() => setTestState(prev => ({ ...prev, [id]: null })), 4000)
    }
  }

  const deleteRule = async (id) => {
    setRules(prev => prev.filter(r => r.id !== id))
    await notifications.deleteRule(id).catch(() => reload())
  }

  const toggleRule = async (id, active) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, active } : r))
    await notifications.updateRule(id, { active }).catch(() => reload())
  }

  const [editingRuleId, setEditingRuleId] = useState(null)

  const updateRule = (updated) => {
    setRules(prev => prev.map(r => r.id === updated.id ? updated : r))
    setEditingRuleId(null)
  }

  const contactById = (id) => contacts.find(c => c.id === id)

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold" style={{ color: '#FFB800' }}>Notifications</h2>

      {error && (
        <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</p>
      )}

      <Card title="Contacts">
        {contacts.length === 0 && !addingContact && (
          <p className="text-gray-500 text-sm mb-3">No contacts yet.</p>
        )}
        {contacts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#3A3A3A]">
                  <TH />
                  <TH>Name</TH>
                  <TH>Type</TH>
                  <TH>Address</TH>
                  <TH>Carrier</TH>
                  <TH right>Actions</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#3A3A3A]">
                {contacts.map(c => (
                  <tr key={c.id} style={{ opacity: c.active ? 1 : 0.45 }}>
                    <td className="py-3 pr-3 w-10">
                      <Toggle enabled={!!c.active} onChange={v => toggleContact(c.id, v)} />
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-sm font-medium text-white">{c.name}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge label={c.type} color={c.type === 'sms' ? 'green' : 'blue'} />
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-xs text-gray-400 font-mono">{c.value}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-xs text-gray-500">
                        {c.carrier ? (CARRIERS.find(x => x.value === c.carrier)?.label ?? c.carrier) : '—'}
                      </span>
                    </td>
                    <td className="py-3 text-right" style={{ opacity: 1 }}>
                      <div className="flex items-center justify-end gap-4">
                        <button
                          onClick={() => testContact(c.id)}
                          disabled={testState[c.id] === 'sending'}
                          className="text-xs transition-colors disabled:opacity-50"
                          style={{
                            color: testState[c.id] === 'ok' ? '#4ADE80'
                              : testState[c.id] === 'error' ? '#F87171'
                              : '#9CA3AF'
                          }}
                        >
                          {testState[c.id] === 'sending' ? 'Sending…'
                            : testState[c.id] === 'ok' ? 'Sent ✓'
                            : testState[c.id] === 'error' ? 'Failed ✗'
                            : 'Test'}
                        </button>
                        <button
                          onClick={() => deleteContact(c.id)}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {addingContact
          ? <ContactForm onSave={addContact} onCancel={() => setAddingContact(false)} smsProvider={smsProvider} />
          : (
            <button
              onClick={() => setAddingContact(true)}
              className="mt-3 px-4 py-1.5 bg-[#3A3A3A] hover:bg-[#484848] text-white text-sm rounded-md transition-colors"
            >
              + Add Contact
            </button>
          )
        }
      </Card>

      <Card title="Notification Rules">
        {rules.length === 0 && !addingRule && (
          <p className="text-gray-500 text-sm mb-3">No rules yet. Rules control when each contact receives notifications.</p>
        )}
        {rules.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#3A3A3A]">
                  <TH />
                  <TH>Contact</TH>
                  <TH>Detections</TH>
                  <TH>Status</TH>
                  <TH>Time</TH>
                  <TH>Frequency</TH>
                  <TH right>Actions</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#3A3A3A]">
                {rules.map(r => {
                  const contact = contactById(r.contact_id)
                  return (
                    <tr key={r.id} style={{ opacity: r.active ? 1 : 0.45 }}>
                      <td className="py-3 pr-3 w-10">
                        <Toggle enabled={!!r.active} onChange={v => toggleRule(r.id, v)} />
                      </td>
                      <td className="py-3 pr-4">
                        <div>
                          <span className="text-sm font-medium text-white">{contact?.name ?? `Contact ${r.contact_id}`}</span>
                          {contact && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              <Badge label={contact.type} color={contact.type === 'sms' ? 'green' : 'blue'} />
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {r.categories?.length
                            ? r.categories.map(c => (
                                <span key={c} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                                  style={CATEGORY_STYLE[c] || CATEGORY_STYLE.other}>{c}</span>
                              ))
                            : <span className="text-xs text-gray-500 italic">All</span>
                          }
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {r.device_statuses?.length
                            ? r.device_statuses.map(s => (
                                <span key={s} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                                  style={STATUS_STYLE[s] || { background: 'rgba(156,163,175,0.15)', color: '#9CA3AF' }}>{s}</span>
                              ))
                            : <span className="text-xs text-gray-500 italic">All</span>
                          }
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          {r.time_start && r.time_end ? `${r.time_start} – ${r.time_end}` : '—'}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          {FREQUENCY_LABEL[r.frequency] ?? r.frequency ?? 'Instant'}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-4">
                          <button
                            onClick={() => setEditingRuleId(editingRuleId === r.id ? null : r.id)}
                            className="text-xs text-gray-400 hover:text-white transition-colors"
                          >
                            {editingRuleId === r.id ? 'Cancel' : 'Edit'}
                          </button>
                          <button
                            onClick={() => deleteRule(r.id)}
                            className="text-xs text-red-400 hover:text-red-300 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {editingRuleId && (
          <RuleForm
            contacts={contacts}
            initialValues={rules.find(r => r.id === editingRuleId)}
            onUpdate={updateRule}
            onCancel={() => setEditingRuleId(null)}
          />
        )}
        {contacts.length > 0 && !editingRuleId && (addingRule
          ? <RuleForm contacts={contacts} onSave={addRule} onCancel={() => setAddingRule(false)} />
          : (
            <button
              onClick={() => setAddingRule(true)}
              className="mt-3 px-4 py-1.5 bg-[#3A3A3A] hover:bg-[#484848] text-white text-sm rounded-md transition-colors"
            >
              + Add Rule
            </button>
          )
        )}
        {contacts.length === 0 && (
          <p className="text-xs text-gray-600 mt-2">Add a contact first to create rules.</p>
        )}
      </Card>

      <NotificationLog />
    </div>
  )
}
