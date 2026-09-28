const MINUTE_MS = 60_000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const formatters = new Map()

function partsFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      }),
    )
  }
  return formatters.get(timeZone)
}

function parseIsoDate(dateIso) {
  const [year, month, day] = dateIso.split('-').map(Number)
  return { year, month, day }
}

/** Minutes to add to UTC to get the wall-clock time in `timeZone` at `utcMs`. */
export function timeZoneOffsetMinutes(utcMs, timeZone) {
  const parts = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  )
  const wallMs = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  )
  return Math.round((wallMs - Math.floor(utcMs / 1000) * 1000) / MINUTE_MS)
}

/**
 * The UTC instant of a wall-clock time in `timeZone`.
 * `minutesFromMidnight` may reach 1440 (midnight at the end of the day).
 */
export function zonedTimeToUtc(dateIso, minutesFromMidnight, timeZone) {
  const { year, month, day } = parseIsoDate(dateIso)
  const wallMs = Date.UTC(year, month - 1, day) + minutesFromMidnight * MINUTE_MS
  // Two passes settle the offset when the first guess lands across a DST change.
  const guess = wallMs - timeZoneOffsetMinutes(wallMs, timeZone) * MINUTE_MS
  return wallMs - timeZoneOffsetMinutes(guess, timeZone) * MINUTE_MS
}

export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const { year, month, day } = parseIsoDate(value)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function addDays(dateIso, days) {
  const { year, month, day } = parseIsoDate(dateIso)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function mondayOf(dateIso) {
  const { year, month, day } = parseIsoDate(dateIso)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return addDays(dateIso, -((weekday + 6) % 7))
}

export function dayOfMonth(dateIso) {
  return parseIsoDate(dateIso).day
}

export function formatMonthDay(dateIso) {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Clock label for minutes after midnight, e.g. 1110 is "6:30 pm". */
export function formatClock(minutesFromMidnight) {
  const hour = Math.floor(minutesFromMidnight / 60) % 24
  const minute = minutesFromMidnight % 60
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`
}
