import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { DeviceStatusProvider } from './context/DeviceStatusContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Cameras from './pages/Cameras'
import Detections from './pages/Detections'
import Notifications from './pages/Notifications'
import Settings from './pages/Settings'
import Setup from './pages/Setup'
import EventDetail from './pages/EventDetail'
import CameraDetail from './pages/CameraDetail'
import Layout from './components/Layout'

export default function App() {
  const { isAuthenticated } = useAuth()

  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="*" element={
        !isAuthenticated ? <Login /> : (
          <DeviceStatusProvider>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/cameras" element={<Cameras />} />
                <Route path="/detections" element={<Detections />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/network" element={<Navigate to="/settings" replace />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/events/:eventId" element={<EventDetail />} />
                <Route path="/cameras/:cameraId" element={<CameraDetail />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </Layout>
          </DeviceStatusProvider>
        )
      } />
    </Routes>
  )
}
