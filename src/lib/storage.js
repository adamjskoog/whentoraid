import { DEFAULT_CHECKIN_DEADLINE } from './guild.js'
import { STATE_VERSION } from './model.js'
import { isIsoDate, isValidTimeZone } from './time.js'
import { DEFAULT_RAID_ID, defaultRaids, validateRaid } from './raids.js'

const STORAGE_KEY = 'whentoraid-v3'
/** Where unreadable saved data is kept, so a fresh setup cannot overwrite it. */
export const UNREADABLE_KEY = 'whentoraid-unreadable'

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

/** Existing rosters and composition become the 20-player raid; the two 10-player raids start empty. */
export function migrateV5(state) {
  const { targets, durationSlots, ...settings } = state.settings
  return {
    ...state,
    version: 6,
    currentRaidId: DEFAULT_RAID_ID,
    settings: { ...settings, raids: defaultRaids(targets, durationSlots) },
    weeks: Object.fromEntries(
      Object.entries(state.weeks).map(([iso, { plan, ...week }]) => [
        iso,
        {
          ...week,
          plans: plan ? { [DEFAULT_RAID_ID]: plan } : {},
        },
      ]),
    ),
  }
}

function migrateV6(state) {
  return { ...state, version: 7, templates: {} }
}

const MIGRATIONS = { 3: migrateV3, 4: migrateV4, 5: migrateV5, 6: migrateV6 }

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
    isValidTimeZone(value.guild?.timezone) &&
    typeof value.settings === 'object' &&
    Array.isArray(value.settings?.raids) &&
    value.settings.raids.length > 0 &&
    value.settings.raids.length <= 10 &&
    value.settings.raids.every(
      (r) => typeof r?.id === 'string' && /^[a-z0-9-]{1,64}$/.test(r.id) && !validateRaid(r),
    ) &&
    new Set(value.settings.raids.map((r) => r.id)).size === value.settings.raids.length &&
    value.settings.raids.some((r) => r.id === value.currentRaidId) &&
    value.weeks !== null &&
    Object.values(value.weeks).every(
      (week) => week?.checkins && week?.plans && typeof week.plans === 'object',
    )
  )
}

/** Saved state from JSON text, or null when it is not a usable guild. */
export function parseState(text) {
  try {
    const parsed = migrateState(JSON.parse(text ?? 'null'))
    return isValidState(parsed) ? parsed : null
  } catch {
    return null
  }
}

function readStored(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Saved state, or null when nothing usable is stored. */
export function loadState() {
  return parseState(readStored(STORAGE_KEY))
}

/**
 * Saved state, plus the raw text when something is stored but cannot be used (corrupt, or saved by
 * a newer version). That text is copied to UNREADABLE_KEY first, so setting up a new guild, which
 * overwrites the main key, does not destroy it.
 * @returns {{ state: import('./model.js').AppState | null, unreadable: string | null }}
 */
export function loadSaved() {
  const raw = readStored(STORAGE_KEY)
  const state = parseState(raw)
  if (state || raw === null) return { state, unreadable: null }
  try {
    localStorage.setItem(UNREADABLE_KEY, raw)
  } catch {
    // Storage is full or blocked; the caller still offers the text for download.
  }
  return { state: null, unreadable: raw }
}

/** Why saved text could not be loaded, for the recovery notice. */
export function unreadableReason(raw) {
  try {
    const version = JSON.parse(raw)?.version
    if (Number.isInteger(version) && version > STATE_VERSION) {
      return 'It was saved by a newer version of WhenToRaid.'
    }
  } catch {
    return 'It is damaged and cannot be read.'
  }
  return 'It is missing required fields.'
}

/** @returns {boolean} false when browser storage is unavailable or full. */
export function saveState(state) {
  try {
    const json = JSON.stringify(state)
    // Skipping identical writes keeps other tabs from receiving a storage event for a no-op.
    if (localStorage.getItem(STORAGE_KEY) !== json) localStorage.setItem(STORAGE_KEY, json)
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

/** Whether two guilds differ in anything besides the week each viewer is looking at. */
export function sameGuild(a, b) {
  if (!a || !b) return a === b
  return (
    JSON.stringify({ ...a, currentWeek: '', currentRaidId: '' }) ===
    JSON.stringify({ ...b, currentWeek: '', currentRaidId: '' })
  )
}

/**
 * Call `onchange(state)` when another tab saves or clears the guild; `state` is null when it was
 * cleared. Saves this tab cannot read (e.g. from a newer version of the app in another tab) go to
 * `onunreadable()` instead, so the caller can stop saving rather than overwrite them.
 * @returns {() => void} unsubscribe
 */
export function watchOtherTabs(onchange, onunreadable = () => {}) {
  function handle(event) {
    if (event.key !== STORAGE_KEY && event.key !== null) return
    if (event.newValue === null) {
      onchange(null)
      return
    }
    const state = parseState(event.newValue)
    if (state) onchange(state)
    else onunreadable()
  }
  window.addEventListener('storage', handle)
  return () => window.removeEventListener('storage', handle)
}

/** A backup file's contents: the full guild, as saved. */
export function backupJson(state) {
  return JSON.stringify(state, null, 2)
}

/** @returns {{ state: import('./model.js').AppState } | { error: string }} */
export function parseBackup(text) {
  const state = parseState(text)
  if (state) return { state }
  const reason = text ? unreadableReason(text) : 'The file is empty.'
  return { error: `That file is not a WhenToRaid backup. ${reason}` }
}
