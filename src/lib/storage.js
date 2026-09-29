import { DEFAULT_CHECKIN_DEADLINE } from './guild.js'
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

/** v5 adds member Discord IDs and a weekly check-in deadline. Plans gain optional attendance. */
function migrateV4(state) {
  return {
    ...state,
    version: 5,
    members: (state.members ?? []).map((m) => ({ discordId: '', ...m })),
    settings: { checkinDeadline: { ...DEFAULT_CHECKIN_DEADLINE }, ...state.settings },
  }
}

const MIGRATIONS = { 3: migrateV3, 4: migrateV4 }

/** Bring older saved state up to the current version, one step at a time. Unknown versions pass through. */
export function migrateState(value) {
  let state = value
  while (state && MIGRATIONS[state.version]) state = MIGRATIONS[state.version](state)
  return state
}

function isValidState(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.version === STATE_VERSION &&
    isIsoDate(value.currentWeek) &&
    typeof value.currentMemberId === 'string' &&
    Array.isArray(value.members) &&
    value.members.some((m) => m?.id === value.currentMemberId) &&
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

/** Forget the saved guild, so the next load starts at setup. @returns {boolean} false when storage is unavailable. */
export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
