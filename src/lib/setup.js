import { DEFAULT_CHECKIN_DEADLINE, gridFromHours, validateGuild } from './guild.js'
import { addMember } from './members.js'
import { STATE_VERSION } from './model.js'
import { mondayOf, todayIso } from './time.js'
import { DEFAULT_RAID_ID, defaultRaids } from './raids.js'

/** Starting raid shape for a new guild: 2 tanks, 4 healers, 14 damage, 3 hours. Officers can change it. */
export const DEFAULT_TARGETS = [2, 4, 14]
export const DEFAULT_DURATION_SLOTS = 6

/**
 * @typedef {{
 *   guildName: string, timezone: string, startHour: number, endHour: number,
 *   memberName: string, discordId?: string,
 *   character: { name: string, realm: string, class: string, spec: string, role: string },
 * }} SetupInput
 */

/**
 * A new guild with the person setting it up as its first member, planning the current week.
 * @param {SetupInput} input
 * @param {{ now?: number, makeId?: () => string }} [options]
 * @returns {{ state: import('./model.js').AppState } | { error: string }}
 */
export function createGuildState(input, { now = Date.now(), makeId } = {}) {
  const { guildName, timezone, startHour, endHour } = input
  const error = validateGuild({ name: guildName, timezone, startHour, endHour }, DEFAULT_DURATION_SLOTS)
  if (error) return { error }

  const empty = {
    version: STATE_VERSION,
    currentWeek: mondayOf(todayIso(timezone, now)),
    currentMemberId: '',
    currentRaidId: DEFAULT_RAID_ID,
    guild: {
      name: guildName.trim(),
      timezone,
      ...gridFromHours(startHour, endHour),
      discordServerId: '',
      officerRoleIds: '',
    },
    settings: {
      raids: defaultRaids(),
      checkinDeadline: { ...DEFAULT_CHECKIN_DEADLINE },
    },
    members: [],
    templates: {},
    characters: [],
    weeks: {},
  }
  const added = addMember(
    empty,
    { name: input.memberName, discordId: input.discordId },
    input.character,
    makeId,
  )
  if (added.error) return { error: added.error }
  return { state: { ...added.state, currentMemberId: added.memberId } }
}
