import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Cameras from './pages/Cameras'
import Detections from './pages/Detections'
import Notifications from './pages/Notifications'
import Network from './pages/Network'
import Settings from './pages/Settings'
import Layout from './components/Layout'

export default function App() {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) return <Login />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/cameras" element={<Cameras />} />
        <Route path="/detections" element={<Detections />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/network" element={<Network />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  )
}
