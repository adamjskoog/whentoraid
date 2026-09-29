import { getCheckin } from './model.js'
import { escapeDiscord } from './roster-export.js'
import { addDays, formatMonthDay, zonedTimeToUtc } from './time.js'

/** Members who have not answered for the week, in guild order. */
export function waitingOn(state, weekIso) {
  return state.members.filter((m) => !getCheckin(state, weekIso, m.id).checkedIn)
}

/** The week's check-in deadline as a UTC instant, or null when the guild has none. */
export function deadlineUtc(state, weekIso) {
  const deadline = state.settings.checkinDeadline
  if (!deadline) return null
  return zonedTimeToUtc(addDays(weekIso, deadline.day), deadline.minutes, state.guild.timezone)
}

/** A Discord mention when the member's ID is known; otherwise their name as plain text. */
function mention(member) {
  return member.discordId ? `<@${member.discordId}>` : escapeDiscord(member.name)
}

/**
 * Discord message nudging everyone who has not checked in. The deadline uses Discord timestamps,
 * so each reader sees it in their own timezone. Returns null when nobody is outstanding.
 */
export function reminderDiscord(state, weekIso) {
  const missing = waitingOn(state, weekIso)
  if (missing.length === 0) return null

  const deadline = deadlineUtc(state, weekIso)
  const seconds = deadline === null ? null : Math.floor(deadline / 1000)
  const ask =
    seconds === null
      ? 'Please mark when you can raid this week.'
      : `Please mark when you can raid this week by <t:${seconds}:F> (<t:${seconds}:R>).`
  return [
    `**${escapeDiscord(state.guild.name)} · raid check-in · week of ${formatMonthDay(weekIso)}**`,
    ask,
    'If you can’t make it, press “Can’t make it this week” so we know.',
    `Still waiting on: ${missing.map(mention).join(', ')}`,
  ].join('\n')
}
