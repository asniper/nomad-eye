import { useState } from 'react'
import axios from 'axios'

const AUTH_KEY = 'nomadeye_auth'

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem(AUTH_KEY))

  const login = async (username, password) => {
    const res = await axios.post('/api/auth/login', { username, password })
    if (res.data.success) {
      const token = btoa(`${username}:${password}`)
      localStorage.setItem(AUTH_KEY, token)
      axios.defaults.headers.common['Authorization'] = `Basic ${token}`
      setIsAuthenticated(true)
      return true
    }
    return false
  }

  const logout = () => {
    localStorage.removeItem(AUTH_KEY)
    delete axios.defaults.headers.common['Authorization']
    setIsAuthenticated(false)
  }

  const stored = localStorage.getItem(AUTH_KEY)
  if (stored && !axios.defaults.headers.common['Authorization']) {
    axios.defaults.headers.common['Authorization'] = `Basic ${stored}`
  }

  return { isAuthenticated, login, logout }
}
