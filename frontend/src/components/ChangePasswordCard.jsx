import { useState } from 'react'
import Card from './Card'
import { useAuth } from '../hooks/useAuth'
import { auth as authApi } from '../api/client'

const MIN_PASSWORD_LENGTH = 8

// Shared by Settings → System (admins) and the sidebar account menu (every role) —
// keep this as the one place password-change validation lives.
export default function ChangePasswordCard() {
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
    if (next.length < MIN_PASSWORD_LENGTH) { setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`); return }
    setSaving(true)
    try {
      await authApi.changePassword(current, next)
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
