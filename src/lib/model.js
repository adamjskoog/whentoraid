import { CLASS_COLORS, DURATION_OPTIONS, MAX_RAID_SIZE, ROLES } from './constants.js'
import { addInterval, removeInterval } from './intervals.js'
import { isIsoDate, mondayOf } from './time.js'

/**
 * Members and characters are stored once. Each week holds only check-ins
 * (availability as UTC ranges plus characters declined that week) and the plan.
 *
 * @typedef {import('./intervals.js').Interval} Interval
 * @typedef {import('./engine.js').RosterEntry} RosterEntry
 * @typedef {{ id: string, name: string }} Member
 * @typedef {{ id: string, memberId: string, name: string, class: string, spec: string, role: string, realm: string, main: boolean }} Character
 * @typedef {{ checkedIn: boolean, ranges: Interval[], declined: string[] }} Checkin
 *   `checkedIn` means the member responded for the week, even if the answer is "not available".
 * @typedef {{ start: number, team: RosterEntry[], locked?: string[] }} Plan
 *   `start` is the session start in UTC ms. `locked` lists member IDs that rebuilds must keep;
 *   plans saved before locks existed have no `locked` field.
 * @typedef {{ checkins: Record<string, Checkin>, plan: Plan | null }} Week
 * @typedef {{
 *   version: number,
 *   currentWeek: string,
 *   currentMemberId: string,
 *   guild: { name: string, timezone: string, dayStartHour: number, slotsPerDay: number, discordServerId: string, officerRoleIds: string },
 *   settings: { targets: number[], durationSlots: number },
 *   members: Member[],
 *   characters: Character[],
 *   weeks: Record<string, Week>,
 * }} AppState
 */

export const STATE_VERSION = 4

const CHARACTER_FIELDS = [
  { key: 'name', label: 'Name', max: 30 },
  { key: 'realm', label: 'Realm', max: 60 },
  { key: 'spec', label: 'Specialization', max: 40 },
]

export function emptyCheckin() {
  return { checkedIn: false, ranges: [], declined: [] }
}

export function getWeek(state, weekIso) {
  return state.weeks[weekIso] ?? { checkins: {}, plan: null }
}

export function getCheckin(state, weekIso, memberId) {
  return getWeek(state, weekIso).checkins[memberId] ?? emptyCheckin()
}

export function memberById(state, memberId) {
  return state.members.find((m) => m.id === memberId)
}

export function characterById(state, characterId) {
  return state.characters.find((c) => c.id === characterId)
}

export function charactersOf(state, memberId) {
  return state.characters.filter((c) => c.memberId === memberId)
}

export function isOffered(checkin, characterId) {
  return !checkin.declined.includes(characterId)
}

/** The shape the scheduling engine works with, for one week. */
export function enginePlayers(state, weekIso) {
  return state.members.map((member) => {
    const checkin = getCheckin(state, weekIso, member.id)
    return {
      id: member.id,
      checkedIn: checkin.checkedIn,
      ranges: checkin.ranges,
      characters: charactersOf(state, member.id).map((c) => ({
        id: c.id,
        role: c.role,
        main: c.main,
        offered: isOffered(checkin, c.id),
      })),
    }
  })
}

function withWeek(state, weekIso, update) {
  return { ...state, weeks: { ...state.weeks, [weekIso]: update(getWeek(state, weekIso)) } }
}

function withCheckin(state, weekIso, memberId, update) {
  return withWeek(state, weekIso, (week) => ({
    ...week,
    checkins: { ...week.checkins, [memberId]: update(week.checkins[memberId] ?? emptyCheckin()) },
  }))
}

// Check-ins save as they are edited: any change counts immediately and marks the member as checked in.
export function setSlotAvailable(state, weekIso, memberId, interval, available) {
  return withCheckin(state, weekIso, memberId, (checkin) => ({
    ...checkin,
    checkedIn: true,
    ranges: available ? addInterval(checkin.ranges, interval) : removeInterval(checkin.ranges, interval),
  }))
}

/** "Can't make it this week": no availability, but the member has still responded. */
export function markUnavailable(state, weekIso, memberId) {
  return withCheckin(state, weekIso, memberId, (checkin) => ({ ...checkin, checkedIn: true, ranges: [] }))
}

export function setCharacterOffered(state, weekIso, memberId, characterId, offered) {
  return withCheckin(state, weekIso, memberId, (checkin) => {
    const others = checkin.declined.filter((id) => id !== characterId)
    return { ...checkin, checkedIn: true, declined: offered ? others : [...others, characterId] }
  })
}

/** True when the member offers at least one character this week, so the planner can place them. */
export function isOfferingAny(state, weekIso, memberId) {
  const checkin = getCheckin(state, weekIso, memberId)
  return charactersOf(state, memberId).some((c) => isOffered(checkin, c.id))
}

/** Saves the plan. Locks are kept only for members still on the team. */
export function setPlan(state, weekIso, plan) {
  const onTeam = new Set(plan.team.map((e) => e.memberId))
  const locked = (plan.locked ?? []).filter((id) => onTeam.has(id))
  return withWeek(state, weekIso, (week) => ({
    ...week,
    plan: { start: plan.start, team: [...plan.team], locked },
  }))
}

export function setCurrentWeek(state, dateIso) {
  if (!isIsoDate(dateIso)) return state
  return { ...state, currentWeek: mondayOf(dateIso) }
}

export function validateCharacter(input) {
  const value = {
    name: String(input.name ?? '').trim(),
    realm: String(input.realm ?? '').trim(),
    spec: String(input.spec ?? '').trim(),
    class: String(input.class ?? ''),
    role: String(input.role ?? ''),
  }
  for (const { key, label, max } of CHARACTER_FIELDS) {
    if (!value[key]) return { error: `${label} is required.` }
    if (value[key].length > max) return { error: `${label} must be ${max} characters or fewer.` }
  }
  if (!Object.hasOwn(CLASS_COLORS, value.class)) return { error: 'Choose a valid class.' }
  if (!ROLES.includes(value.role)) return { error: 'Choose a valid raid role.' }
  return { value }
}

/**
 * Edits the member's character when `input.id` names one; otherwise adds a new character.
 * @returns {{ state: AppState, error?: string }}
 */
export function saveCharacter(state, memberId, input, makeId = () => crypto.randomUUID()) {
  const { value, error } = validateCharacter(input)
  if (error) return { state, error }

  const existing = state.characters.find((c) => c.id === input.id && c.memberId === memberId)
  if (existing) {
    return {
      state: {
        ...state,
        characters: state.characters.map((c) => (c.id === existing.id ? { ...existing, ...value } : c)),
      },
    }
  }
  const added = { id: makeId(), memberId, main: false, ...value }
  return { state: { ...state, characters: [...state.characters, added] } }
}

/** Make one of the member's characters their main; the others become alts. */
export function setMainCharacter(state, memberId, characterId) {
  const owns = state.characters.some((c) => c.id === characterId && c.memberId === memberId)
  if (!owns) return state
  return {
    ...state,
    characters: state.characters.map((c) =>
      c.memberId === memberId ? { ...c, main: c.id === characterId } : c,
    ),
  }
}

function withoutCharacter(plan, characterId) {
  const team = plan.team.filter((e) => e.characterId !== characterId)
  const locked = (plan.locked ?? []).filter((id) => team.some((e) => e.memberId === id))
  return { ...plan, team, locked }
}

/**
 * Delete one of the member's characters and every reference to it: roster entries, locks on those
 * entries, and weekly "declined" lists. A member's only character cannot be deleted. If the main is
 * deleted, the member's first remaining character becomes the main.
 * @returns {{ state: AppState, error?: string }}
 */
export function deleteCharacter(state, memberId, characterId) {
  const mine = charactersOf(state, memberId)
  const target = mine.find((c) => c.id === characterId)
  if (!target) return { state, error: 'Character not found.' }
  if (mine.length === 1)
    return { state, error: 'You need at least one character. Add another before deleting this one.' }

  const remaining = state.characters.filter((c) => c.id !== characterId)
  const nextMainId = target.main ? remaining.find((c) => c.memberId === memberId).id : null
  const characters = remaining.map((c) => (c.id === nextMainId ? { ...c, main: true } : c))

  const weeks = Object.fromEntries(
    Object.entries(state.weeks).map(([weekIso, week]) => {
      const checkins = Object.fromEntries(
        Object.entries(week.checkins).map(([id, checkin]) => [
          id,
          { ...checkin, declined: checkin.declined.filter((d) => d !== characterId) },
        ]),
      )
      return [weekIso, { ...week, checkins, plan: week.plan && withoutCharacter(week.plan, characterId) }]
    }),
  )
  return { state: { ...state, characters, weeks } }
}

/**
 * The character to show for a member who is not on the roster: their main if offered this week,
 * then any offered character, then their main, then their first character.
 */
export function preferredCharacter(state, weekIso, memberId) {
  const checkin = getCheckin(state, weekIso, memberId)
  const mine = charactersOf(state, memberId)
  const offered = mine.filter((c) => isOffered(checkin, c.id))
  return offered.find((c) => c.main) ?? offered[0] ?? mine.find((c) => c.main) ?? mine[0]
}

export function validateSettings(input) {
  const { targets, durationSlots, discordServerId, officerRoleIds } = input
  const validTargets =
    Array.isArray(targets) &&
    targets.length === ROLES.length &&
    targets.every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_RAID_SIZE)
  if (!validTargets) return `Role slots must be whole numbers from 0 to ${MAX_RAID_SIZE}.`

  const total = targets.reduce((sum, n) => sum + n, 0)
  if (total < 1 || total > MAX_RAID_SIZE) return `Choose between 1 and ${MAX_RAID_SIZE} total raid slots.`
  if (!DURATION_OPTIONS.includes(durationSlots)) return 'Choose a valid raid duration.'
  if (!/^\d*$/.test(discordServerId)) return 'Discord server ID must contain only digits.'
  if (!/^[\d, ]*$/.test(officerRoleIds)) return 'Officer role IDs must be digits separated by commas.'
  return null
}

/** @returns {{ state: AppState, error?: string }} */
export function saveSettings(state, input) {
  const error = validateSettings(input)
  if (error) return { state, error }
  return {
    state: {
      ...state,
      settings: { targets: [...input.targets], durationSlots: input.durationSlots },
      guild: { ...state.guild, discordServerId: input.discordServerId, officerRoleIds: input.officerRoleIds },
    },
  }
}
