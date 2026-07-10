import React, { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import logoUrl from '../assets/logo-narrow.png'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const ok = await login(username, password)
      if (!ok) setError('Invalid credentials')
    } catch {
      setError('Login failed')
    }
  }

  return (
    <div className="min-h-screen bg-[#1A1A1A] flex items-center justify-center p-4">
      <div className="bg-[#2E2E2E] p-8 rounded-xl w-full max-w-sm shadow-2xl border border-[#3A3A3A]">
        <div className="mb-6">
          <img src={logoUrl} alt="Nomad Eye" className="h-auto w-auto mx-auto block" />
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            className="w-full bg-[#3A3A3A] border border-[#484848] rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-[#151925] transition-colors"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
          />
          <input
            type="password"
            className="w-full bg-[#3A3A3A] border border-[#484848] rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-[#151925] transition-colors"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: '#FFB800', color: '#151925' }}
          >
            Login
          </button>
        </form>
      </div>
    </div>
  )
}
