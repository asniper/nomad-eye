import { createContext, useContext, useState } from 'react'
import axios from 'axios'

const AUTH_KEY = 'nomadeye_auth'
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const stored = localStorage.getItem(AUTH_KEY)
    if (stored) {
      axios.defaults.headers.common['Authorization'] = `Basic ${stored}`
      return true
    }
    return false
  })

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

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
