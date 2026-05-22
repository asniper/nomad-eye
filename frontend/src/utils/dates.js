const TZ_KEY = 'nomadeye_timezone'

export function getTimezone() {
  return localStorage.getItem(TZ_KEY) || Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function setTimezone(tz) {
  localStorage.setItem(TZ_KEY, tz)
}

export function formatDateTime(ts) {
  try {
    return new Date(ts).toLocaleString('en-US', { timeZone: getTimezone() })
  } catch {
    return new Date(ts).toLocaleString()
  }
}

export function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('en-US', {
      timeZone: getTimezone(),
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return new Date(ts).toLocaleTimeString()
  }
}
