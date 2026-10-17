import { CLASS_COLORS, DURATION_OPTIONS, MAX_RAID_SIZE, ROLES } from './constants.js'
import { gridFromHours, raidHours, validateDeadline, validateGuild } from './guild.js'
import { addInterval, removeInterval } from './intervals.js'
import { addDays, daysBetween, isIsoDate, mondayOf, todayIso } from './time.js'
import { slotWindow } from './grid.js'
import { getRaid, validateRaid } from './raids.js'
import { templateFor, templateFromRanges, templateRanges } from './availability-template.js'
import { own } from './ids.js'

/**
 * Members and characters are stored once. Each week holds only check-ins
 * (availability as UTC ranges plus characters declined that week) and the plan.
 *
 * @typedef {import('./intervals.js').Interval} Interval
 * @typedef {import('./engine.js').RosterEntry} RosterEntry
 * @typedef {{ id: string, name: string, discordId: string, officer?: boolean }} Member
 *   `discordId` is the member's Discord user ID ('' when unknown), used to mention them in reminders
 *   and, online, to let them sign in. `officer` matters only for online guilds.
 * @typedef {{ id: string, memberId: string, name: string, class: string, spec: string, role: string, realm: string, main: boolean, retired?: boolean }} Character
 *   `retired` characters were deleted by their player: hidden everywhere except past and current rosters.
 * @typedef {{
 *   checkedIn: boolean, ranges: Interval[], declined: string[],
 *   preferredRanges?: Interval[], tentativeRanges?: Interval[], absentDates?: string[],
 * }} Checkin
 *   `checkedIn` means the member responded for the week, even if the answer is "not available".
 *   `ranges` are firm times. `preferredRanges` lie within them; `tentativeRanges` never overlap them.
 *   `absentDates` are guild days this week the member is away: their times are kept but not offered.
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
 *   settings: { raids: { id: string, name: string, size: number, targets: number[], durationSlots: number }[], checkinDeadline: Deadline | null, trackAttendance?: boolean },
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
  return { ...week, plan: own(week.plans, state.currentRaidId) ?? null }
}

/** The member's check-in as saved (or filled in by their usual schedule), before absences apply. */
export function getRawCheckin(state, weekIso, memberId) {
  const saved = own(getWeek(state, weekIso).checkins, memberId)
  if (saved) return saved
  const ranges = templateRanges(own(state.templates, memberId), weekIso)
  return ranges === null ? emptyCheckin() : { checkedIn: true, ranges, declined: [] }
}

/** The member's check-in with absent days removed from every kind of availability. */
export function getCheckin(state, weekIso, memberId) {
  const checkin = getRawCheckin(state, weekIso, memberId)
  if (!checkin.absentDates?.length) return checkin
  const windows = checkin.absentDates.map((dateIso) =>
    slotWindow(weekIso, daysBetween(weekIso, dateIso), 0, state.guild.slotsPerDay, state.guild),
  )
  const mask = (ranges) => windows.reduce(removeInterval, ranges ?? [])
  return {
    ...checkin,
    ranges: mask(checkin.ranges),
    preferredRanges: mask(checkin.preferredRanges),
    tentativeRanges: mask(checkin.tentativeRanges),
  }
}

export function memberById(state, memberId) {
  return state.members.find((m) => m.id === memberId)
}

export function characterById(state, characterId) {
  return state.characters.find((c) => c.id === characterId)
}

/** The member's active characters. Retired ones stay in `state.characters` so rosters keep their names. */
export function charactersOf(state, memberId) {
  return state.characters.filter((c) => c.memberId === memberId && !c.retired)
}

export function isOffered(checkin, characterId, raidId) {
  const preference = own(checkin.raids, raidId)
  return (
    preference?.participating !== false && !(preference?.declined ?? checkin.declined).includes(characterId)
  )
}

/**
 * The character as it plays in one raid: a spec the player chose for that raid at Discord sign-up
 * (`signedAs` in the check-in) replaces its saved spec and role. The saved character is unchanged.
 */
export function raidCharacter(checkin, character, raidId) {
  const choice = own(checkin.raids, raidId)?.signedAs
  return choice?.characterId === character.id
    ? { ...character, spec: choice.spec, role: choice.role }
    : character
}

/** A roster entry's character as it plays in that raid (see raidCharacter), or undefined if removed. */
export function rosterCharacter(state, weekIso, entry, raidId = state.currentRaidId) {
  const character = characterById(state, entry.characterId)
  return character && raidCharacter(getCheckin(state, weekIso, entry.memberId), character, raidId)
}

/** The member's active characters as they play in one raid of a week (see raidCharacter). */
export function raidCharactersOf(state, weekIso, memberId, raidId = state.currentRaidId) {
  const checkin = getCheckin(state, weekIso, memberId)
  return charactersOf(state, memberId).map((c) => raidCharacter(checkin, c, raidId))
}

/** The shape the scheduling engine works with, for one week. */
export function enginePlayers(state, weekIso) {
  return state.members.map((member) => {
    const checkin = getCheckin(state, weekIso, member.id)
    return {
      id: member.id,
      checkedIn: checkin.checkedIn,
      ranges: checkin.ranges,
      tentativeRanges: checkin.tentativeRanges ?? [],
      preferredRanges: checkin.preferredRanges ?? [],
      characters: charactersOf(state, member.id)
        .map((c) => raidCharacter(checkin, c, state.currentRaidId))
        .map((c) => ({
          id: c.id,
          role: c.role,
          class: c.class,
          spec: c.spec,
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

/** Edits apply to the saved check-in, so absences never erase the times underneath them. */
function withCheckin(state, weekIso, memberId, update) {
  return updateWeek(state, weekIso, (week) => ({
    ...week,
    checkins: { ...week.checkins, [memberId]: update(getRawCheckin(state, weekIso, memberId)) },
  }))
}

/** Put back one member's saved check-in for a week; `undefined` returns them to their usual schedule. */
export function restoreCheckin(state, weekIso, memberId, checkin) {
  return updateWeek(state, weekIso, (week) => {
    const { [memberId]: _current, ...others } = week.checkins
    return { ...week, checkins: checkin ? { ...others, [memberId]: checkin } : others }
  })
}

// Check-ins save as they are edited: any change counts immediately and marks the member as checked in.
export function setSlotAvailable(state, weekIso, memberId, interval, available) {
  return setAvailabilityKind(state, weekIso, memberId, interval, 'firm', available)
}

export const AVAILABILITY_KINDS = ['preferred', 'firm', 'tentative']

function withKinds(checkin, { ranges, preferredRanges, tentativeRanges }) {
  return { ...checkin, checkedIn: true, ranges, preferredRanges, tentativeRanges }
}

/**
 * Mark `interval` as one kind of availability (`on`), or clear that kind from it.
 * Preferred times are firm. Firm and tentative never overlap, so a tentative player can never make a
 * roster look guaranteed. Clearing "preferred" keeps the time firm; clearing "firm" clears preferred too.
 * @param {'preferred' | 'firm' | 'tentative'} kind
 */
export function setAvailabilityKind(state, weekIso, memberId, interval, kind, on) {
  if (!AVAILABILITY_KINDS.includes(kind)) return state
  return withCheckin(state, weekIso, memberId, (checkin) => {
    let ranges = checkin.ranges
    let preferredRanges = checkin.preferredRanges ?? []
    let tentativeRanges = checkin.tentativeRanges ?? []
    if (on) {
      ranges = kind === 'tentative' ? removeInterval(ranges, interval) : addInterval(ranges, interval)
      preferredRanges =
        kind === 'preferred'
          ? addInterval(preferredRanges, interval)
          : removeInterval(preferredRanges, interval)
      tentativeRanges =
        kind === 'tentative'
          ? addInterval(tentativeRanges, interval)
          : removeInterval(tentativeRanges, interval)
    } else if (kind === 'tentative') {
      tentativeRanges = removeInterval(tentativeRanges, interval)
    } else {
      preferredRanges = removeInterval(preferredRanges, interval)
      if (kind === 'firm') ranges = removeInterval(ranges, interval)
    }
    return withKinds(checkin, { ranges, preferredRanges, tentativeRanges })
  })
}

/** "Can't make it this week": no availability, but the member has still responded. */
export function markUnavailable(state, weekIso, memberId) {
  return withCheckin(state, weekIso, memberId, (checkin) =>
    withKinds(checkin, { ranges: [], preferredRanges: [], tentativeRanges: [] }),
  )
}

/** Longest absence one change may set, in days (a year, leap day included). */
export const MAX_ABSENCE_DAYS = 366

/**
 * Mark the member away (or back) on every day from `fromIso` to `toIso`, inclusive. Their times stay
 * saved underneath, so removing the absence restores them. Being away counts as responding; removing
 * the last away day from a week with no times leaves that week unanswered again.
 * @returns {{ state: AppState, error?: string }}
 */
export function setAbsenceDates(state, memberId, fromIso, toIso, absent) {
  if (!memberById(state, memberId)) return { state, error: 'Player not found.' }
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) return { state, error: 'Choose valid dates.' }
  const span = daysBetween(fromIso, toIso)
  if (span < 0) return { state, error: 'The last day must be on or after the first day.' }
  if (span >= MAX_ABSENCE_DAYS) return { state, error: 'Choose an absence of one year or less.' }

  let next = state
  for (let weekIso = mondayOf(fromIso); weekIso <= toIso; weekIso = addDays(weekIso, 7)) {
    const days = Array.from({ length: 7 }, (_, d) => addDays(weekIso, d)).filter(
      (dateIso) => dateIso >= fromIso && dateIso <= toIso,
    )
    next = withCheckin(next, weekIso, memberId, (checkin) => {
      const { absentDates: previous = [], ...rest } = checkin
      const kept = previous.filter((dateIso) => !days.includes(dateIso))
      const absentDates = absent ? [...kept, ...days].sort() : kept
      // Without away days or any times left, the week no longer holds an answer.
      const answered =
        absentDates.length > 0 || checkin.ranges.length > 0 || checkin.tentativeRanges?.length > 0
      return {
        ...rest,
        checkedIn: absent || (checkin.checkedIn && answered),
        ...(absentDates.length ? { absentDates } : {}),
      }
    })
  }
  return { state: next }
}

/** The member's absences from today on, merged into date spans. */
export function upcomingAbsences(state, memberId, now = Date.now()) {
  const today = todayIso(state.guild.timezone, now)
  const dates = Object.values(state.weeks)
    .flatMap((week) => own(week.checkins, memberId)?.absentDates ?? [])
    .filter((dateIso) => dateIso >= today)
    .sort()
  return dates.reduce((spans, dateIso) => {
    const last = spans.at(-1)
    if (last && addDays(last.to, 1) === dateIso) return [...spans.slice(0, -1), { ...last, to: dateIso }]
    return [...spans, { from: dateIso, to: dateIso }]
  }, [])
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
      [raidId]: {
        ...checkin.raids?.[raidId],
        declined: checkin.raids?.[raidId]?.declined ?? checkin.declined,
        participating,
      },
    },
  }))
}

/**
 * Save the week's times as the usual schedule from that week on. The schedule it replaces stays as
 * `previous` for the week before, so a week whose check-ins already closed keeps its times.
 */
export function saveAvailabilityTemplate(state, weekIso, memberId, now = Date.now()) {
  const checkin = getCheckin(state, weekIso, memberId)
  const existing = own(state.templates, memberId)
  // Only one older schedule is kept. When saving for a later week, keep the one covering this
  // week, since this week's check-ins may already be closed; weeks in between then use it too.
  const thisWeek = mondayOf(todayIso(state.guild.timezone, now))
  const weekBefore = templateFor(existing, addDays(weekIso, -7))
  const previous = weekIso > thisWeek ? (templateFor(existing, thisWeek) ?? weekBefore) : weekBefore
  const template = templateFromRanges(weekIso, checkin.ranges, state.guild)
  return {
    ...state,
    templates: { ...state.templates, [memberId]: previous ? { ...template, previous } : template },
  }
}

export function removeAvailabilityTemplate(state, memberId) {
  const { [memberId]: _removed, ...templates } = state.templates ?? {}
  return { ...state, templates }
}

/** Reset just the week's time override; keep its raid and character choices. */
export function useAvailabilityTemplate(state, weekIso, memberId) {
  const ranges = templateRanges(own(state.templates, memberId), weekIso)
  if (ranges === null) return state
  return withCheckin(state, weekIso, memberId, (checkin) =>
    withKinds(checkin, { ranges, preferredRanges: [], tentativeRanges: [] }),
  )
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

/** Attendance tracking is a guild setting, off unless an officer turns it on. */
export function tracksAttendance(state) {
  return state.settings.trackAttendance === true
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

  const existing = charactersOf(state, memberId).find((c) => c.id === input.id)
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
  const owns = charactersOf(state, memberId).some((c) => c.id === characterId)
  if (!owns) return state
  return {
    ...state,
    characters: state.characters.map((c) =>
      c.memberId === memberId && !c.retired ? { ...c, main: c.id === characterId } : c,
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

/**
 * What "Delete character" does: retire one of the member's characters. It disappears from their
 * list, sign-ups, and the planner's choices, but rosters and attendance keep it, so history is not
 * rewritten. Only the member's own character rows change, which online players are allowed to write;
 * officers take a retired character off a current roster by hand (the planner flags it).
 * A member's only active character cannot be retired. If the main is retired, the member's first
 * remaining active character becomes the main.
 * @returns {{ state: AppState, error?: string }}
 */
export function retireCharacter(state, memberId, characterId) {
  const mine = charactersOf(state, memberId)
  const target = mine.find((c) => c.id === characterId)
  if (!target) return { state, error: 'Character not found.' }
  if (mine.length === 1)
    return { state, error: 'You need at least one character. Add another before deleting this one.' }

  const nextMainId = target.main ? mine.find((c) => c.id !== characterId).id : null
  const characters = state.characters.map((c) => {
    if (c.id === characterId) return { ...c, main: false, retired: true }
    return c.id === nextMainId ? { ...c, main: true } : c
  })
  return { state: { ...state, characters } }
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
 *   checkinDeadline: Deadline | null, trackAttendance: boolean,
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
    trackAttendance: tracksAttendance(state),
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
        trackAttendance: full.trackAttendance === true,
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
