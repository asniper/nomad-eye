import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('nomadeye_auth')
  if (token) cfg.headers['Authorization'] = `Bearer ${token}`
  return cfg
})

// A 401 on most endpoints means the session token is missing/expired/revoked — drop it
// and force back to the login screen. But login/change-password are expected to 401 on
// a plain wrong-password user error, not a revoked session — let those bubble up so the
// calling form can show its own inline error instead of getting logged out mid-typo.
const AUTH_ERROR_IS_USER_INPUT = ['/auth/login', '/auth/change-password']

api.interceptors.response.use(
  res => res,
  err => {
    const url = err?.config?.url || ''
    const isUserInputAuthCall = AUTH_ERROR_IS_USER_INPUT.some(p => url.startsWith(p))
    if (err?.response?.status === 401 && !isUserInputAuthCall) {
      localStorage.removeItem('nomadeye_auth')
      localStorage.removeItem('nomadeye_user')
      if (window.location.pathname !== '/setup') {
        window.location.href = '/'
      }
    }
    return Promise.reject(err)
  }
)

export const auth = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    api.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword }),
  users: {
    list: () => api.get('/auth/users'),
    create: (username, password, role) => api.post('/auth/users', { username, password, role }),
    update: (id, body) => api.patch(`/auth/users/${id}`, body),
    remove: (id) => api.delete(`/auth/users/${id}`),
  },
}

export const cameras = {
  list: () => api.get('/cameras/'),
  refresh: () => api.post('/cameras/refresh'),
  toggleOverlay: (id, enabled) => api.post(`/cameras/${id}/overlay?enabled=${enabled}`),
  setName: (id, name) => api.patch(`/cameras/${id}/name`, { name }),
  remove: (id) => api.delete(`/cameras/${id}`),
  deletePermanent: (id) => api.delete(`/cameras/${id}/permanent`),
  reload: (id) => api.post(`/cameras/${id}/reload`),
  resetTracking: (id) => api.post(`/cameras/${id}/reset-tracking`),
  setEnabled: (id, enabled) => api.post(`/cameras/${id}/enabled?enabled=${enabled}`),
  getControls: (id) => api.get(`/cameras/${id}/controls`),
  setAdjustments: (id, data) => api.patch(`/cameras/${id}/adjustments`, data),
  setFaceSettings: (id, data) => api.patch(`/cameras/${id}/face-settings`, data),
  setNightMode: (id, mode) => api.patch(`/cameras/${id}/night-mode`, { mode }),
  snapshot: (id) => api.get(`/cameras/${id}/snapshot`, { responseType: 'blob' }),
  listZones: (id) => api.get(`/cameras/${id}/zones`),
  createZone: (id, data) => api.post(`/cameras/${id}/zones`, data),
  deleteZone: (id, zoneId) => api.delete(`/cameras/${id}/zones/${zoneId}`),
}

export const detections = {
  list: (params) => api.get('/detections/', { params }),
  events: (params) => api.get('/detections/events', { params }),
  event: (id) => api.get(`/detections/events/${id}`),
  image: (id) => api.get(`/detections/${id}/image`, { responseType: 'blob' }),
  storage: () => api.get('/detections/storage'),
  purge: (category, images_only) => api.delete('/detections/purge', { data: { category, images_only } }),
  deleteEvent: (event_id) => api.delete(`/detections/events/${event_id}`),
  clip: (event_id) => api.get(`/detections/events/${event_id}/clip`, { responseType: 'blob' }),
  deleteClip: (event_id) => api.delete(`/detections/events/${event_id}/clip`),
  clipsStorage: () => api.get('/detections/clips/storage'),
  purgeClips: () => api.delete('/detections/clips'),
  continuousStorage: () => api.get('/detections/continuous/storage'),
  listContinuous: (cameraId, date, tz) =>
    api.get('/detections/continuous', { params: { camera_id: cameraId, date, tz } }),
  continuousSummary: (cameraId) =>
    api.get('/detections/continuous/summary', { params: { camera_id: cameraId } }),
  continuousVideo: (segmentId) => api.get(`/detections/continuous/${segmentId}/video`, { responseType: 'blob' }),
  deleteContinuous: (segmentId) => api.delete(`/detections/continuous/${segmentId}`),
  lockContinuous: (segmentId, locked) => api.post(`/detections/continuous/${segmentId}/lock`, { locked }),
}

export const notifications = {
  listContacts: () => api.get('/notifications/contacts'),
  createContact: (data) => api.post('/notifications/contacts', data),
  deleteContact: (id) => api.delete(`/notifications/contacts/${id}`),
  testContact: (id) => api.post(`/notifications/contacts/${id}/test`),
  patchContact: (id, data) => api.patch(`/notifications/contacts/${id}`, data),
  updateRule: (id, data) => api.patch(`/notifications/rules/${id}`, data),
  listRules: () => api.get('/notifications/rules'),
  createRule: (data) => api.post('/notifications/rules', data),
  deleteRule: (id) => api.delete(`/notifications/rules/${id}`),
  log: (params) => api.get('/notifications/log', { params }),
  clearLog: () => api.delete('/notifications/log'),
}

export const network = {
  status: () => api.get('/network/'),
  known: () => api.get('/network/known'),
  scan: () => api.get('/network/scan'),
  connect: (ssid, password) => api.post('/network/connect', { ssid, password }),
  connectSaved: (ssid) => api.post('/network/connect-saved', { ssid }),
  add: (ssid, password) => api.post('/network/add', { ssid, password }),
  deleteKnown: (ssid) => api.delete(`/network/known/${encodeURIComponent(ssid)}`),
  apStart: () => api.post('/network/ap/start'),
  apStop: () => api.post('/network/ap/stop'),
  tailscale: () => api.get('/network/tailscale'),
  tailscaleAuthUrl: () => api.post('/network/tailscale/auth-url'),
  tailscaleUp: (authKey = '') => api.post('/network/tailscale/up', { auth_key: authKey }),
  tailscaleDown: () => api.post('/network/tailscale/down'),
  tailscaleLogout: () => api.post('/network/tailscale/logout'),
  tailscaleEnableHttps: () => api.post('/network/tailscale/enable-https'),
}

export const settings = {
  getAll: () => api.get('/settings/'),
  set: (key, value) => api.post('/settings/', { key, value: String(value) }),
  getModels: () => api.get('/settings/models'),
  getNotificationUrl: () => api.get('/settings/notification-url'),
}

export const status = {
  get: () => api.get('/status/'),
  set: (s) => api.post('/status/', { status: s }),
}

export const system = {
  stats: () => api.get('/system/stats'),
  restart: () => api.post('/system/restart'),
  reboot: () => api.post('/system/reboot'),
  updateStatus: () => api.get('/system/update-status'),
  update: () => api.post('/system/update'),
  saveUpdateSettings: (data) => api.post('/system/update-settings', data),
}

export const faces = {
  list: () => api.get('/faces/'),
  image: (id) => api.get(`/faces/${id}/image`, { responseType: 'blob' }),
  rename: (id, name) => api.patch(`/faces/${id}`, { name }),
  delete: (id) => api.delete(`/faces/${id}`),
  deleteUnknown: () => api.delete('/faces/unknown'),
  mergeInto: (sourceId, targetId) => api.post(`/faces/${sourceId}/merge-into/${targetId}`),
  disassociate: (id) => api.post(`/faces/${id}/disassociate`),
  capture: (camera_id, name) => api.post(`/faces/capture?camera_id=${camera_id}&name=${encodeURIComponent(name)}`),
  backend: () => api.get('/faces/backend'),
}

export const presence = {
  listDevices: () => api.get('/presence/devices'),
  addDevice: (data) => api.post('/presence/devices', data),
  patchDevice: (id, data) => api.patch(`/presence/devices/${id}`, data),
  deleteDevice: (id) => api.delete(`/presence/devices/${id}`),
  scan: () => api.get('/presence/scan'),
  status: () => api.get('/presence/status'),
}

export const storage = {
  devices: () => api.get('/storage/devices'),
  mount: (device) => api.post(`/storage/devices/${device}/mount`),
  unmount: (device) => api.post(`/storage/devices/${device}/unmount`),
  format: (device) => api.post(`/storage/devices/${device}/format`),
  setPrimary: (device) => api.post(`/storage/devices/${device}/set-primary`),
  setClipsPrimary: (device) => api.post(`/storage/devices/${device}/set-clips-primary`),
  setPrimaryInternal: () => api.post('/storage/set-primary-internal'),
  status: () => api.get('/storage/status'),
  browse: () => api.get('/storage/browse'),
}
