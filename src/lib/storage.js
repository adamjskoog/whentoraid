import { DEFAULT_CHECKIN_DEADLINE, validateDeadline, validateGuild } from './guild.js'
import { ROLES } from './constants.js'
import { isSafeId } from './ids.js'
import { STATE_VERSION } from './model.js'
import { addDays, isIsoDate } from './time.js'
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

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
const isTimestamp = (value) => Number.isFinite(value) && Math.abs(value) <= 8.64e15
const isRange = (range) =>
  isObject(range) && isTimestamp(range.start) && isTimestamp(range.end) && range.start < range.end

/** Templates keep their original grid even after the guild changes its planning hours. */
function isGrid(grid) {
  return (
    isObject(grid) &&
    Number.isInteger(grid.slotsPerDay) &&
    !validateGuild(
      {
        name: 'Grid',
        timezone: grid.timezone,
        startHour: grid.dayStartHour,
        endHour: grid.dayStartHour + grid.slotsPerDay / 2,
      },
      1,
    )
  )
}

const isMember = (member) => isObject(member) && isSafeId(member.id) && typeof member.name === 'string'

function isCharacter(character, memberIds) {
  return (
    isObject(character) &&
    isSafeId(character.id) &&
    memberIds.has(character.memberId) &&
    ['name', 'realm', 'spec', 'class', 'role'].every((key) => typeof character[key] === 'string') &&
    ROLES.includes(character.role)
  )
}

const isOptionalRanges = (value) => value === undefined || (Array.isArray(value) && value.every(isRange))

/** Absent days are dates inside the check-in's own week. */
const isAbsentDates = (value, weekIso) =>
  value === undefined ||
  (Array.isArray(value) &&
    value.length <= 7 &&
    value.every((dateIso) => isIsoDate(dateIso) && dateIso >= weekIso && dateIso <= addDays(weekIso, 6)))

function isCheckin(checkin, weekIso) {
  return (
    isObject(checkin) &&
    Array.isArray(checkin.ranges) &&
    checkin.ranges.every(isRange) &&
    isOptionalRanges(checkin.preferredRanges) &&
    isOptionalRanges(checkin.tentativeRanges) &&
    isAbsentDates(checkin.absentDates, weekIso) &&
    isStringList(checkin.declined) &&
    (checkin.raids === undefined ||
      (isObject(checkin.raids) &&
        Object.entries(checkin.raids).every(
          ([raidId, choice]) => isSafeId(raidId) && isObject(choice) && isStringList(choice.declined),
        )))
  )
}

function isRoster(plan) {
  return (
    isObject(plan) &&
    isTimestamp(plan.start) &&
    (plan.end === undefined || (isTimestamp(plan.end) && plan.end > plan.start)) &&
    Array.isArray(plan.team) &&
    plan.team.every(
      (entry) =>
        isObject(entry) &&
        isSafeId(entry.memberId) &&
        isSafeId(entry.characterId) &&
        ROLES.includes(entry.role),
    )
  )
}

function isPlan(plan) {
  return (
    isRoster(plan) &&
    (plan.locked === undefined || isStringList(plan.locked)) &&
    (plan.attendance === undefined || plan.attendance === null || isObject(plan.attendance)) &&
    (plan.published == null ||
      (isRoster(plan.published) &&
        isTimestamp(plan.published.publishedAt) &&
        typeof plan.published.raidName === 'string' &&
        Array.isArray(plan.published.targets) &&
        plan.published.targets.length === 3 &&
        plan.published.targets.every((target) => Number.isInteger(target) && target >= 0 && target <= 40)))
  )
}

function isWeek([weekIso, week]) {
  return (
    isIsoDate(weekIso) &&
    isObject(week) &&
    isObject(week.checkins) &&
    Object.entries(week.checkins).every(
      ([memberId, checkin]) => isSafeId(memberId) && isCheckin(checkin, weekIso),
    ) &&
    isObject(week.plans) &&
    Object.entries(week.plans).every(([raidId, plan]) => isSafeId(raidId) && isPlan(plan))
  )
}

const isTemplate = (template) =>
  isGrid(template) &&
  isIsoDate(template.fromWeek) &&
  Array.isArray(template.slots) &&
  template.slots.every((slot) => Number.isInteger(slot) && slot >= 0 && slot < 7 * template.slotsPerDay)

function hasValidRecords(value) {
  const memberIds = new Set(value.members.map((m) => m?.id))
  return (
    value.members.every(isMember) &&
    memberIds.size === value.members.length &&
    value.characters.every((c) => isCharacter(c, memberIds)) &&
    new Set(value.characters.map((c) => c.id)).size === value.characters.length &&
    isObject(value.weeks) &&
    Object.entries(value.weeks).every(isWeek) &&
    (value.templates === undefined ||
      (isObject(value.templates) &&
        Object.entries(value.templates).every(
          ([memberId, template]) =>
            isSafeId(memberId) &&
            isTemplate(template) &&
            (template.previous === undefined || isTemplate(template.previous)),
        )))
  )
}

/**
 * Whether a parsed guild is safe to load. Backups and other tabs' saves are untrusted: a malformed
 * record would otherwise break pages later, when it is first rendered.
 */
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
    isGrid(value.guild) &&
    typeof value.guild.name === 'string' &&
    value.guild.name.trim().length > 0 &&
    value.guild.name.length <= 60 &&
    typeof value.settings === 'object' &&
    !validateDeadline(value.settings?.checkinDeadline) &&
    Array.isArray(value.settings?.raids) &&
    value.settings.raids.length > 0 &&
    value.settings.raids.length <= 10 &&
    value.settings.raids.every(
      (r) =>
        typeof r?.id === 'string' && /^[a-z0-9-]{1,64}$/.test(r.id) && isSafeId(r.id) && !validateRaid(r),
    ) &&
    new Set(value.settings.raids.map((r) => r.id)).size === value.settings.raids.length &&
    value.settings.raids.some((r) => r.id === value.currentRaidId) &&
    hasValidRecords(value)
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

/** Whether two guilds differ in anything besides each tab's viewing and editing context. */
export function sameGuild(a, b) {
  if (!a || !b) return a === b
  return (
    JSON.stringify({ ...a, currentWeek: '', currentRaidId: '', currentMemberId: '' }) ===
    JSON.stringify({ ...b, currentWeek: '', currentRaidId: '', currentMemberId: '' })
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

/**
 * Largest backup accepted. A year-long demo guild is under 1 MB, and browser storage holds roughly 5 MB,
 * so anything past this is not a guild we could keep anyway.
 */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024
export const BACKUP_TOO_LARGE = 'That file is too large to be a WhenToRaid backup.'

/** @returns {{ state: import('./model.js').AppState } | { error: string }} */
export function parseBackup(text) {
  if (text && text.length > MAX_BACKUP_BYTES) return { error: BACKUP_TOO_LARGE }
  const state = parseState(text)
  if (state) return { state }
  const reason = text ? unreadableReason(text) : 'The file is empty.'
  return { error: `That file is not a WhenToRaid backup. ${reason}` }
}
