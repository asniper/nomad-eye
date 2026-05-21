import React, { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

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
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-gray-900 p-8 rounded-xl w-full max-w-sm shadow-2xl">
        <h1 className="text-2xl font-bold mb-6 text-center">Nomad Eye</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
          />
          <input
            type="password"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button className="w-full bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-2 text-sm font-semibold">
            Login
          </button>
        </form>
      </div>
    </div>
  )
}
