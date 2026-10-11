import { templateFor } from './availability-template.js'
import { own } from './ids.js'
import { getCheckin } from './model.js'
import { escapeDiscord } from './roster-export.js'
import { addDays, formatMonthDay, mondayOf, todayIso, zonedTimeToUtc } from './time.js'

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

/**
 * Whether the week's check-ins have closed (its deadline has passed). Online, only officers change
 * a closed week's check-ins; the database enforces this too (enforce_checkin_deadline).
 */
export function checkinsClosed(state, weekIso, now = Date.now()) {
  const deadline = deadlineUtc(state, weekIso)
  return deadline !== null && now >= deadline
}

/** A schedule as text with sorted keys, so copies read back from the database compare equal. */
function scheduleKey(schedule) {
  return schedule ? JSON.stringify(schedule, Object.keys(schedule).sort()) : null
}

/**
 * Whether going from `before` to `after` changes the times a usual schedule fills in for this
 * week after its check-ins closed (the week has no saved check-in of the member's own).
 * Mirrors enforce_template_deadline in the database.
 */
export function changesClosedWeek(before, after, memberId, now = Date.now()) {
  const thisWeek = mondayOf(todayIso(before.guild.timezone, now))
  if (!checkinsClosed(before, thisWeek, now)) return false
  if (own(before.weeks[thisWeek]?.checkins, memberId)) return false
  const covering = (state) => templateFor(own(state.templates, memberId), thisWeek)
  return scheduleKey(covering(before)) !== scheduleKey(covering(after))
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
