import { CLASS_COLORS, DURATION_OPTIONS, MAX_RAID_SIZE, ROLES } from './constants.js'
import { gridFromHours, raidHours, validateDeadline, validateGuild } from './guild.js'
import { addInterval, removeInterval } from './intervals.js'
import { addDays, isIsoDate, mondayOf } from './time.js'
import { getRaid, validateRaid } from './raids.js'
import { templateFromRanges, templateRanges } from './availability-template.js'

/**
 * Members and characters are stored once. Each week holds only check-ins
 * (availability as UTC ranges plus characters declined that week) and the plan.
 *
 * @typedef {import('./intervals.js').Interval} Interval
 * @typedef {import('./engine.js').RosterEntry} RosterEntry
 * @typedef {{ id: string, name: string, discordId: string, officer?: boolean }} Member
 *   `discordId` is the member's Discord user ID ('' when unknown), used to mention them in reminders
 *   and, online, to let them sign in. `officer` matters only for online guilds.
 * @typedef {{ id: string, memberId: string, name: string, class: string, spec: string, role: string, realm: string, main: boolean }} Character
 * @typedef {{ checkedIn: boolean, ranges: Interval[], declined: string[] }} Checkin
 *   `checkedIn` means the member responded for the week, even if the answer is "not available".
 * @typedef {'attended' | 'late' | 'noshow'} Attendance
 * @typedef {{ start: number, team: RosterEntry[], locked?: string[], attendance?: Record<string, Attendance>, cancelled?: boolean }} Plan
 *   `start` is the session start in UTC ms. `locked` lists member IDs that rebuilds must keep.
 *   `attendance` records what happened for rostered members; `cancelled` marks a raid that did not run.
 *   Plans saved by older versions may lack the optional fields.
 * @typedef {{ checkins: Record<string, Checkin>, plans: Record<string, Plan> }} Week
 * @typedef {{ day: number, minutes: number }} Deadline
 *   Weekly check-in deadline: day of the week (0 = Monday) and minutes after midnight, guild time.
 * @typedef {{
 *   version: number,
 *   currentWeek: string,
 *   currentRaidId: string,
 *   currentMemberId: string,
 *   guild: { name: string, timezone: string, dayStartHour: number, slotsPerDay: number, discordServerId: string, officerRoleIds: string },
 *   settings: { raids: { id: string, name: string, size: number, targets: number[], durationSlots: number }[], checkinDeadline: Deadline | null },
 *   members: Member[],
 *   characters: Character[],
 *   weeks: Record<string, Week>,
 * }} AppState
 */

export const STATE_VERSION = 7

const CHARACTER_FIELDS = [
  { key: 'name', label: 'Name', max: 30 },
  { key: 'realm', label: 'Realm', max: 60 },
  { key: 'spec', label: 'Specialization', max: 40 },
]

export function emptyCheckin() {
  return { checkedIn: false, ranges: [], declined: [] }
}

export function getWeek(state, weekIso) {
  const week = state.weeks[weekIso] ?? { checkins: {}, plans: {} }
  // `plan` is a view of the selected raid; only the plans map is persisted.
  return { ...week, plan: week.plans[state.currentRaidId] ?? null }
}

export function getCheckin(state, weekIso, memberId) {
  const saved = getWeek(state, weekIso).checkins[memberId]
  if (saved) return saved
  const ranges = templateRanges(state.templates?.[memberId], weekIso)
  return ranges === null ? emptyCheckin() : { checkedIn: true, ranges, declined: [] }
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

export function isOffered(checkin, characterId, raidId) {
  const preference = checkin.raids?.[raidId]
  return (
    preference?.participating !== false && !(preference?.declined ?? checkin.declined).includes(characterId)
  )
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
        offered: isOffered(checkin, c.id, state.currentRaidId),
      })),
    }
  })
}

/** Replace one week with `update(week)`. */
export function updateWeek(state, weekIso, update) {
  const week = state.weeks[weekIso] ?? { checkins: {}, plans: {} }
  return { ...state, weeks: { ...state.weeks, [weekIso]: update(week) } }
}

/**
 * How many weeks before this one keep their check-ins. Bench fairness reads 4 weeks back; the rest
 * is room to look at recent history. Older weeks keep only their plan (attendance records).
 */
export const CHECKIN_HISTORY_WEEKS = 12

/**
 * Drop check-ins from weeks more than `keepWeeks` before `thisWeekIso`, and drop those weeks entirely
 * when they have no plan, so browser storage does not grow without limit. Returns `state` itself when
 * nothing is old enough to prune.
 */
export function pruneOldWeeks(state, thisWeekIso, keepWeeks = CHECKIN_HISTORY_WEEKS) {
  if (state.demoYear) return state
  const cutoff = addDays(thisWeekIso, -7 * keepWeeks)
  const isOld = ([weekIso, week]) => weekIso < cutoff && Object.keys(week.checkins).length > 0
  if (!Object.entries(state.weeks).some(isOld)) return state

  const weeks = Object.fromEntries(
    Object.entries(state.weeks)
      .map((entry) => (isOld(entry) ? [entry[0], { ...entry[1], checkins: {} }] : entry))
      .filter(([weekIso, week]) => weekIso >= cutoff || Object.keys(week.plans).length),
  )
  return { ...state, weeks }
}

function withCheckin(state, weekIso, memberId, update) {
  return updateWeek(state, weekIso, (week) => ({
    ...week,
    checkins: { ...week.checkins, [memberId]: update(getCheckin(state, weekIso, memberId)) },
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

export function setCharacterOffered(
  state,
  weekIso,
  memberId,
  characterId,
  offered,
  raidId = state.currentRaidId,
) {
  return withCheckin(state, weekIso, memberId, (checkin) => {
    const preference = checkin.raids?.[raidId] ?? { participating: true, declined: checkin.declined }
    const others = preference.declined.filter((id) => id !== characterId)
    return {
      ...checkin,
      checkedIn: true,
      raids: {
        ...checkin.raids,
        [raidId]: { ...preference, declined: offered ? others : [...others, characterId] },
      },
    }
  })
}

export function setRaidParticipation(state, weekIso, memberId, raidId, participating) {
  if (!state.settings.raids.some((raid) => raid.id === raidId)) return state
  return withCheckin(state, weekIso, memberId, (checkin) => ({
    ...checkin,
    checkedIn: true,
    raids: {
      ...checkin.raids,
      [raidId]: { declined: checkin.raids?.[raidId]?.declined ?? checkin.declined, participating },
    },
  }))
}

export function saveAvailabilityTemplate(state, weekIso, memberId) {
  const checkin = getCheckin(state, weekIso, memberId)
  return {
    ...state,
    templates: { ...state.templates, [memberId]: templateFromRanges(weekIso, checkin.ranges, state.guild) },
  }
}

export function removeAvailabilityTemplate(state, memberId) {
  const { [memberId]: _removed, ...templates } = state.templates ?? {}
  return { ...state, templates }
}

/** Reset just the week's time override; keep its raid and character choices. */
export function useAvailabilityTemplate(state, weekIso, memberId) {
  const ranges = templateRanges(state.templates?.[memberId], weekIso)
  if (ranges === null) return state
  return withCheckin(state, weekIso, memberId, (checkin) => ({ ...checkin, checkedIn: true, ranges }))
}

/** True when the member offers at least one character this week, so the planner can place them. */
export function isOfferingAny(state, weekIso, memberId) {
  const checkin = getCheckin(state, weekIso, memberId)
  return charactersOf(state, memberId).some((c) => isOffered(checkin, c.id, state.currentRaidId))
}

/** Keep only the entries of a member-keyed record whose member is still on the team. */
function onlyTeam(record, team) {
  const onTeam = new Set(team.map((e) => e.memberId))
  return Object.fromEntries(Object.entries(record ?? {}).filter(([id]) => onTeam.has(id)))
}

/**
 * Saves the plan. Locks and attendance are kept only for members still on the team.
 * Attendance and the cancelled flag describe one session: they carry over from the saved plan
 * while the start time stays the same (so roster edits after a raid keep what was recorded), and
 * reset when the raid moves to another time, unless `plan` gives them explicitly.
 */
export function setPlan(state, weekIso, plan) {
  const onTeam = new Set(plan.team.map((e) => e.memberId))
  const locked = (plan.locked ?? []).filter((id) => onTeam.has(id))
  return updateWeek(state, weekIso, (week) => {
    const previous = week.plans[state.currentRaidId]
    const sameSession = previous?.start === plan.start
    return {
      ...week,
      plans: {
        ...week.plans,
        [state.currentRaidId]: {
          start: plan.start,
          team: [...plan.team],
          locked,
          attendance: onlyTeam(plan.attendance ?? (sameSession ? previous.attendance : {}), plan.team),
          cancelled: plan.cancelled ?? (sameSession && Boolean(previous.cancelled)),
          published: previous?.published ?? null,
        },
      },
    }
  })
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

/** A plan without the given roster entries, and without locks or attendance for anyone removed. */
export function planWithout(plan, isRemoved) {
  const team = plan.team.filter((e) => !isRemoved(e))
  const locked = (plan.locked ?? []).filter((id) => team.some((e) => e.memberId === id))
  const published = plan.published?.team.some(isRemoved) ? null : plan.published
  return { ...plan, team, locked, attendance: onlyTeam(plan.attendance, team), published: published ?? null }
}

function withoutCharacter(plan, characterId) {
  return planWithout(plan, (e) => e.characterId === characterId)
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
          {
            ...checkin,
            declined: checkin.declined.filter((d) => d !== characterId),
            ...(checkin.raids
              ? {
                  raids: Object.fromEntries(
                    Object.entries(checkin.raids).map(([raidId, pref]) => [
                      raidId,
                      { ...pref, declined: pref.declined.filter((d) => d !== characterId) },
                    ]),
                  ),
                }
              : {}),
          },
        ]),
      )
      const plans = Object.fromEntries(
        Object.entries(week.plans).map(([id, plan]) => [id, withoutCharacter(plan, characterId)]),
      )
      return [weekIso, { ...week, checkins, plans }]
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
  const offered = mine.filter((c) => isOffered(checkin, c.id, state.currentRaidId))
  return offered.find((c) => c.main) ?? offered[0] ?? mine.find((c) => c.main) ?? mine[0]
}

/**
 * @typedef {{
 *   targets: number[], durationSlots: number, discordServerId: string, officerRoleIds: string,
 *   guildName: string, timezone: string, startHour: number, endHour: number,
 *   checkinDeadline: Deadline | null,
 * }} SettingsInput
 */

/** Complete settings input: fields the caller left out keep their current values. */
function withCurrentSettings(state, input) {
  const { startHour, endHour } = raidHours(state.guild)
  const raid = getRaid(state)
  return {
    targets: raid.targets,
    durationSlots: raid.durationSlots,
    raidName: raid.name,
    raidSize: raid.size,
    discordServerId: state.guild.discordServerId,
    officerRoleIds: state.guild.officerRoleIds,
    guildName: state.guild.name,
    timezone: state.guild.timezone,
    startHour,
    endHour,
    checkinDeadline: state.settings.checkinDeadline ?? null,
    ...input,
  }
}

/** @param {SettingsInput} input @returns {string | null} */
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
  const { guildName: name, timezone, startHour, endHour } = input
  return (
    validateGuild({ name, timezone, startHour, endHour }, durationSlots) ??
    validateDeadline(input.checkinDeadline)
  )
}

/**
 * Save raid requirements and guild details. Fields left out of `input` keep their current values.
 * @param {Partial<SettingsInput> & { targets: number[], durationSlots: number }} input
 * @returns {{ state: AppState, error?: string }}
 */
export function saveSettings(state, input) {
  const full = withCurrentSettings(state, input)
  const settingsError = validateSettings(full)
  if (settingsError) return { state, error: settingsError }
  const raid = {
    ...getRaid(state),
    name: full.raidName.trim(),
    size: full.raidSize,
    targets: [...full.targets],
    durationSlots: full.durationSlots,
  }
  const error = validateRaid(raid)
  if (error) return { state, error }
  const raids = state.settings.raids.map((item) => (item.id === raid.id ? raid : item))
  const hoursError = validateGuild(
    { name: full.guildName, timezone: full.timezone, startHour: full.startHour, endHour: full.endHour },
    Math.max(...raids.map((item) => item.durationSlots)),
  )
  if (hoursError) return { state, error: hoursError }
  return {
    state: {
      ...state,
      settings: {
        raids,
        checkinDeadline: full.checkinDeadline && { ...full.checkinDeadline },
      },
      guild: {
        ...state.guild,
        ...gridFromHours(full.startHour, full.endHour),
        name: full.guildName.trim(),
        timezone: full.timezone,
        discordServerId: full.discordServerId,
        officerRoleIds: full.officerRoleIds,
      },
    },
  }
}
