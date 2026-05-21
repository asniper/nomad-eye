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
  toggleOverlay: (id, enabled) => api.post(`/cameras/${id}/overlay?enabled=${enabled}`),
}

export const detections = {
  list: (params) => api.get('/detections/', { params }),
  image: (id) => `/api/detections/${id}/image`,
}

export const notifications = {
  listContacts: () => api.get('/notifications/contacts'),
  createContact: (data) => api.post('/notifications/contacts', data),
  deleteContact: (id) => api.delete(`/notifications/contacts/${id}`),
  listRules: () => api.get('/notifications/rules'),
  createRule: (data) => api.post('/notifications/rules', data),
  deleteRule: (id) => api.delete(`/notifications/rules/${id}`),
}

export const network = {
  status: () => api.get('/network/'),
  known: () => api.get('/network/known'),
  scan: () => api.get('/network/scan'),
  connect: (ssid, password) => api.post('/network/connect', { ssid, password }),
  add: (ssid, password) => api.post('/network/add', { ssid, password }),
  apStart: () => api.post('/network/ap/start'),
  apStop: () => api.post('/network/ap/stop'),
}

export const settings = {
  getAll: () => api.get('/settings/'),
  set: (key, value) => api.post('/settings/', { key, value }),
}

export const status = {
  get: () => api.get('/status/'),
  set: (s) => api.post('/status/', { status: s }),
}
