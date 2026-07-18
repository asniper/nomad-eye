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

// Converts a <input type="datetime-local"> value (a plain "YYYY-MM-DDTHH:mm"
// string with no timezone) into a UTC ISO string, treating it as wall-clock
// time IN `tz` — not the browser's own local timezone. `new Date(str)` on a
// datetime-local value always assumes the browser's system zone, which is
// wrong here: the picker is showing/editing a moment in the app's configured
// timezone (e.g. the camera's), not wherever the viewing device happens to be.
//
// Standard vanilla-JS double-conversion trick, no library: guess the instant
// by treating the wall-clock string as if it were UTC, check what that
// instant's wall-clock actually reads in `tz` (via Intl, which handles DST
// correctly for the guessed date), then correct by the difference.
export function zonedTimeToUtcIso(dateTimeLocalStr, tz) {
  const [datePart, timePart] = dateTimeLocalStr.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = (timePart || '00:00').split(':').map(Number)
  const guessUtc = new Date(Date.UTC(y, m - 1, d, hh, mm))

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(guessUtc).reduce((acc, p) => { acc[p.type] = p.value; return acc }, {})

  const tzAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  )
  const diff = guessUtc.getTime() - tzAsUtc
  return new Date(guessUtc.getTime() + diff).toISOString()
}
