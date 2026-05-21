import { useEffect, useState } from 'react'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { notifications } from '../api/client'

const CATEGORIES = ['people', 'vehicles', 'animals', 'other']
const STATUSES = ['home', 'away', 'sleep', 'vacation']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function ContactForm({ onSave, onCancel }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('sms')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await notifications.createContact({ name, type, value })
      onSave()
    } catch {
      setError('Failed to save contact.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 mt-4 pt-4 border-t border-gray-800">
      <h4 className="text-sm font-medium text-gray-300">New Contact</h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name"
          required
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        />
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="sms">SMS</option>
          <option value="email">Email</option>
        </select>
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={type === 'sms' ? '+1234567890' : 'email@example.com'}
          required
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Add Contact'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-md transition-colors">
          Cancel
        </button>
      </div>
    </form>
  )
}

function RuleForm({ contacts, onSave, onCancel }) {
  const [contactId, setContactId] = useState(contacts[0]?.id || '')
  const [cats, setCats] = useState([])
  const [statuses, setStatuses] = useState([])
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const toggle = (list, setter, val) =>
    setter(list.includes(val) ? list.filter(x => x !== val) : [...list, val])

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await notifications.createRule({
        contact_id: parseInt(contactId),
        categories: cats.length ? cats : null,
        device_statuses: statuses.length ? statuses : null,
        time_start: timeStart || null,
        time_end: timeEnd || null,
      })
      onSave()
    } catch {
      setError('Failed to save rule.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 mt-4 pt-4 border-t border-gray-800">
      <h4 className="text-sm font-medium text-gray-300">New Rule</h4>
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Contact</label>
        <select
          value={contactId}
          onChange={e => setContactId(e.target.value)}
          required
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          {contacts.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Categories (empty = all)</label>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => toggle(cats, setCats, c)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                cats.includes(c) ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Device statuses (empty = all)</label>
        <div className="flex gap-2 flex-wrap">
          {STATUSES.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => toggle(statuses, setStatuses, s)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                statuses.includes(s) ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Time window (optional)</label>
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={timeStart}
            onChange={e => setTimeStart(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
          <span className="text-gray-500 text-sm">to</span>
          <input
            type="time"
            value={timeEnd}
            onChange={e => setTimeEnd(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Add Rule'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-md transition-colors">
          Cancel
        </button>
      </div>
    </form>
  )
}

export default function Notifications() {
  const [contacts, setContacts] = useState([])
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [addingContact, setAddingContact] = useState(false)
  const [addingRule, setAddingRule] = useState(false)

  const reload = () => {
    Promise.all([
      notifications.listContacts().then(r => setContacts(r.data)).catch(() => {}),
      notifications.listRules().then(r => setRules(r.data)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const deleteContact = async (id) => {
    await notifications.deleteContact(id).catch(() => {})
    reload()
  }

  const deleteRule = async (id) => {
    await notifications.deleteRule(id).catch(() => {})
    reload()
  }

  const contactById = (id) => contacts.find(c => c.id === id)

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Notifications</h2>

      <Card title="Contacts">
        {contacts.length === 0 && !addingContact && (
          <p className="text-gray-500 text-sm mb-3">No contacts yet.</p>
        )}
        <div className="divide-y divide-gray-800">
          {contacts.map(c => (
            <div key={c.id} className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-3">
                <Badge label={c.type} color={c.type === 'sms' ? 'green' : 'blue'} />
                <div>
                  <p className="text-sm font-medium text-white">{c.name}</p>
                  <p className="text-xs text-gray-500">{c.value}</p>
                </div>
              </div>
              <button
                onClick={() => deleteContact(c.id)}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        {addingContact
          ? <ContactForm onSave={() => { setAddingContact(false); reload() }} onCancel={() => setAddingContact(false)} />
          : (
            <button
              onClick={() => setAddingContact(true)}
              className="mt-3 px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-md transition-colors"
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
        <div className="divide-y divide-gray-800">
          {rules.map(r => {
            const contact = contactById(r.contact_id)
            return (
              <div key={r.id} className="py-3 flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-medium text-white">{contact?.name ?? `Contact ${r.contact_id}`}</p>
                  <div className="flex flex-wrap gap-1.5 text-xs text-gray-400">
                    {r.categories?.length
                      ? r.categories.map(c => <span key={c} className="bg-gray-800 px-2 py-0.5 rounded capitalize">{c}</span>)
                      : <span className="text-gray-600">All categories</span>
                    }
                    {r.device_statuses?.length
                      ? r.device_statuses.map(s => <span key={s} className="bg-gray-800 px-2 py-0.5 rounded capitalize">{s}</span>)
                      : <span className="text-gray-600">All statuses</span>
                    }
                    {r.time_start && r.time_end && (
                      <span className="bg-gray-800 px-2 py-0.5 rounded">{r.time_start}–{r.time_end}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteRule(r.id)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0"
                >
                  Remove
                </button>
              </div>
            )
          })}
        </div>
        {contacts.length > 0 && (addingRule
          ? <RuleForm contacts={contacts} onSave={() => { setAddingRule(false); reload() }} onCancel={() => setAddingRule(false)} />
          : (
            <button
              onClick={() => setAddingRule(true)}
              className="mt-3 px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-md transition-colors"
            >
              + Add Rule
            </button>
          )
        )}
        {contacts.length === 0 && (
          <p className="text-xs text-gray-600 mt-2">Add a contact first to create rules.</p>
        )}
      </Card>
    </div>
  )
}
