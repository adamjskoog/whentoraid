import { STATE_VERSION } from './model.js'
import { isIsoDate } from './time.js'

const STORAGE_KEY = 'whentoraid-v3'

/**
 * v3 had a separate submit step (`submitted`). v4 saves as you edit (`checkedIn`), so a v3 draft
 * with any edits counts as checked in, the same as it would have if made after this change.
 */
function migrateV3(state) {
  const weeks = Object.fromEntries(
    Object.entries(state.weeks ?? {}).map(([weekIso, week]) => {
      const checkins = Object.fromEntries(
        Object.entries(week.checkins ?? {}).map(([memberId, { submitted, ...checkin }]) => {
          const edited = checkin.ranges.length > 0 || checkin.declined.length > 0
          return [memberId, { ...checkin, checkedIn: Boolean(submitted) || edited }]
        }),
      )
      return [weekIso, { ...week, checkins }]
    }),
  )
  return { ...state, version: 4, weeks }
}

/** Bring older saved state up to the current version. Unknown versions are returned unchanged. */
export function migrateState(value) {
  if (value?.version === 3) return migrateV3(value)
  return value
}

function isValidState(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.version === STATE_VERSION &&
    isIsoDate(value.currentWeek) &&
    typeof value.currentMemberId === 'string' &&
    Array.isArray(value.members) &&
    Array.isArray(value.characters) &&
    typeof value.weeks === 'object' &&
    typeof value.guild === 'object' &&
    typeof value.settings === 'object'
  )
}

/** Saved state, or null when nothing usable is stored. */
export function loadState() {
  try {
    const parsed = migrateState(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
    return isValidState(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** @returns {boolean} false when browser storage is unavailable or full. */
export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}
