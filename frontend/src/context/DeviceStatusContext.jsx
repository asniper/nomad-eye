import { createContext, useContext, useEffect, useState } from 'react'
import { status } from '../api/client'

const DeviceStatusContext = createContext(null)

export function DeviceStatusProvider({ children }) {
  const [deviceStatus, setDeviceStatus] = useState('home')

  useEffect(() => {
    status.get().then(r => setDeviceStatus(r.data.status)).catch(() => {})
  }, [])

  const updateStatus = async (s) => {
    setDeviceStatus(s)
    await status.set(s).catch(() => {})
  }

  return (
    <DeviceStatusContext.Provider value={{ deviceStatus, updateStatus }}>
      {children}
    </DeviceStatusContext.Provider>
  )
}

export const useDeviceStatus = () => useContext(DeviceStatusContext)
