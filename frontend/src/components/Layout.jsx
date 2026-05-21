import React from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const nav = [
  { to: '/', label: 'Dashboard' },
  { to: '/cameras', label: 'Cameras' },
  { to: '/detections', label: 'Detections' },
  { to: '/notifications', label: 'Notifications' },
  { to: '/network', label: 'Network' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout({ children }) {
  const { logout } = useAuth()
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-56 bg-gray-900 flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-bold tracking-wide text-white">Nomad Eye</h1>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-800">
          <button
            onClick={logout}
            className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-md"
          >
            Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )
}
