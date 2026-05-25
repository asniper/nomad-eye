import React, { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useDeviceStatus } from '../context/DeviceStatusContext'
import { getTimezone } from '../utils/dates'
import logoNarrowUrl from '../assets/logo-narrow.png'

function NavClock() {
  const [time, setTime] = useState('')
  const [date, setDate] = useState('')
  useEffect(() => {
    const tick = () => {
      try {
        const tz = getTimezone()
        setTime(new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' }))
        setDate(new Date().toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }))
      } catch {
        setTime(new Date().toLocaleTimeString())
        setDate(new Date().toLocaleDateString())
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="px-3 pb-2">
      <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <p className="text-xs text-white/70">{date}</p>
        <p className="text-sm font-mono text-white/90 tracking-wide">{time}</p>
      </div>
    </div>
  )
}

const nav = [
  { to: '/', label: 'Dashboard' },
  { to: '/cameras', label: 'Cameras' },
  { to: '/detections', label: 'Detections' },
  { to: '/notifications', label: 'Notifications' },
  { to: '/settings', label: 'Settings' },
]

const STATUS_OPTIONS = ['home', 'away', 'sleep', 'vacation']
const STATUS_COLOR = { home: '#198F53', away: '#FFB800', sleep: '#3B82F6', vacation: '#EF4444' }

export default function Layout({ children }) {
  const { logout } = useAuth()
  const { deviceStatus, updateStatus } = useDeviceStatus()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden">
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 flex flex-col shrink-0 border-r border-black/30 transition-transform md:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ background: 'linear-gradient(to bottom, #4c6e5d, #151925)', width: '262px' }}
      >
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <img src={logoNarrowUrl} alt="Nomad Eye" className="h-auto w-auto" />
          {menuOpen && (
            <button
              onClick={() => setMenuOpen(false)}
              className="md:hidden text-white/60 hover:text-white p-1 shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {nav.map(({ to, label }) => (
            <React.Fragment key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-white/20 text-white font-semibold'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                {label}
              </NavLink>

              {/* Device status + clock inline under Settings */}
              {to === '/settings' && deviceStatus !== null && (
                <>
                  <div className="px-3 pb-1">
                    <p className="text-xs text-white/40 mb-1.5">Device Status</p>
                    <div className="flex gap-1">
                      {STATUS_OPTIONS.map(s => (
                        <button
                          key={s}
                          onClick={() => updateStatus(s)}
                          className="flex-1 py-1 rounded text-xs font-medium capitalize transition-opacity hover:opacity-80 text-center"
                          style={deviceStatus === s
                            ? { background: STATUS_COLOR[s], color: '#fff' }
                            : { background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }
                          }
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <NavClock />
                </>
              )}
            </React.Fragment>
          ))}
        </nav>

        <div className="p-3 border-t border-white/10">
          <button
            onClick={logout}
            className="w-full text-left px-3 py-2 text-sm text-white/60 hover:text-white hover:bg-white/10 rounded-md transition-colors"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile top bar */}
        <div
          className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-black/30 shrink-0"
          style={{ background: 'linear-gradient(to right, #4c6e5d, #151925)' }}
        >
          <button
            onClick={() => setMenuOpen(true)}
            className="text-white/70 hover:text-white p-1"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <img src={logoNarrowUrl} alt="Nomad Eye" className="max-h-20 w-auto" />
        </div>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
