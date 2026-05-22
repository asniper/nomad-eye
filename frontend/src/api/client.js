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
  reload: (id) => api.post(`/cameras/${id}/reload`),
  resetTracking: (id) => api.post(`/cameras/${id}/reset-tracking`),
}

export const detections = {
  list: (params) => api.get('/detections/', { params }),
  events: (params) => api.get('/detections/events', { params }),
  event: (id) => api.get(`/detections/events/${id}`),
  image: (id) => api.get(`/detections/${id}/image`, { responseType: 'blob' }),
  storage: () => api.get('/detections/storage'),
  purge: (category, images_only) => api.delete('/detections/purge', { data: { category, images_only } }),
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
}

export const settings = {
  getAll: () => api.get('/settings/'),
  set: (key, value) => api.post('/settings/', { key, value: String(value) }),
}

export const status = {
  get: () => api.get('/status/'),
  set: (s) => api.post('/status/', { status: s }),
}

export const system = {
  stats: () => api.get('/system/stats'),
  restart: () => api.post('/system/restart'),
  reboot: () => api.post('/system/reboot'),
}

export const storage = {
  devices: () => api.get('/storage/devices'),
  mount: (device) => api.post(`/storage/devices/${device}/mount`),
  unmount: (device) => api.post(`/storage/devices/${device}/unmount`),
  format: (device) => api.post(`/storage/devices/${device}/format`),
  setPrimary: (device) => api.post(`/storage/devices/${device}/set-primary`),
  setPrimaryInternal: () => api.post('/storage/set-primary-internal'),
  status: () => api.get('/storage/status'),
  browse: () => api.get('/storage/browse'),
}
