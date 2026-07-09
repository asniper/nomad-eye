import { createContext, useContext, useState } from 'react'
import axios from 'axios'
import { auth as authApi } from '../api/client'

const AUTH_KEY = 'nomadeye_auth'
const USER_KEY = 'nomadeye_user'
const AuthContext = createContext(null)

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null')
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const stored = localStorage.getItem(AUTH_KEY)
    if (stored) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${stored}`
      return true
    }
    return false
  })
  const [user, setUser] = useState(readStoredUser)

  const login = async (username, password) => {
    const res = await authApi.login(username, password)
    if (res.data.success) {
      const { token, id, role } = res.data
      const loggedInUser = { id, username, role }
      localStorage.setItem(AUTH_KEY, token)
      localStorage.setItem(USER_KEY, JSON.stringify(loggedInUser))
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
      setUser(loggedInUser)
      setIsAuthenticated(true)
      return true
    }
    return false
  }

  const logout = async () => {
    // Must fire before clearing the token — the request interceptor in api/client.js
    // reads localStorage at dispatch time, so clearing first sends this with no
    // Authorization header and the server-side session row never actually gets deleted.
    try {
      await authApi.logout()
    } catch {}
    localStorage.removeItem(AUTH_KEY)
    localStorage.removeItem(USER_KEY)
    delete axios.defaults.headers.common['Authorization']
    setIsAuthenticated(false)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
