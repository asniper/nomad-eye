import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use(cfg => {
  const stored = localStorage.getItem('nomadeye_auth')
  if (stored) cfg.headers['Authorization'] = `Basic ${stored}`
  return cfg
})

export const auth = {
  login: (username, password) => api.post('/auth/login', { username, password }),
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
}

export const settings = {
  getAll: () => api.get('/settings/'),
  set: (key, value) => api.post('/settings/', { key, value: String(value) }),
  getModels: () => api.get('/settings/models'),
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
  changePassword: (current_password, new_password) => api.post('/system/change-password', { current_password, new_password }),
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
