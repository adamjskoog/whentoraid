import { ROLES } from './constants.js'
import { conflicts } from './engine.js'
import { formatSession } from './grid.js'
import { characterById, memberById } from './model.js'
import { benchGroups } from './planning.js'
import { formatMonthDay } from './time.js'

/** Discord's per-message limit without Nitro. */
export const DISCORD_MESSAGE_LIMIT = 2000

const ROLE_HEADINGS = { Tank: 'Tanks', Healer: 'Healers', DPS: 'Damage' }

function describeEntry(state, entry, players, plan) {
  const member = memberById(state, entry.memberId)
  const character = characterById(state, entry.characterId)
  if (!member || !character) return null
  return { member, character, warnings: conflicts(entry, players, plan) }
}

/** Plain-text roster for sharing outside the app. */
export function rosterText(state, plan, players) {
  const { guild, settings, currentWeek } = state
  const lines = plan.team.map((entry) => {
    const described = describeEntry(state, entry, players, plan)
    if (!described) return `${entry.role}: (missing character)`
    const { member, character, warnings } = described
    const warningText = warnings.length ? ` | WARNING: ${warnings.join(', ')}` : ''
    return `${entry.role}: ${character.name} (${member.name}) — ${character.spec} ${character.class}${warningText}`
  })
  return [
    `WhenToRaid — week of ${currentWeek}`,
    `${formatSession(plan.day, plan.startSlot, settings.durationSlots, guild)} · ${guild.timezone}`,
    'DRAFT ROSTER',
    ...lines,
    ...benchLines(state, players, plan, (text) => `${text}:`, String),
  ].join('\n')
}

/**
 * Escape Discord markdown and break mentions so player-entered names render as plain text
 * and can never ping @everyone, @here, a user (<@id>), or a role.
 */
export function escapeDiscord(text) {
  return String(text)
    .replace(/[\\*_~`|<>[\]]/g, '\\$&')
    .replace(/@/g, '@​')
}

const discordTime = (ms, style) => `<t:${Math.floor(ms / 1000)}:${style}>`

/** Markdown roster for pasting into Discord. Times use Discord timestamps, shown in each reader's timezone. */
export function rosterDiscord(state, plan, players) {
  const { guild, settings, currentWeek } = state

  const roleSections = ROLES.flatMap((role, i) => {
    const entries = plan.team.filter((e) => e.role === role)
    const lines = entries.map((entry) => {
      const described = describeEntry(state, entry, players, plan)
      if (!described) return '- (missing character)'
      const { member, character, warnings } = described
      const warningText = warnings.length ? ` ⚠ ${warnings.join(', ')}` : ''
      return `- ${escapeDiscord(character.name)} (${escapeDiscord(member.name)}) · ${escapeDiscord(`${character.spec} ${character.class}`)}${warningText}`
    })
    return [`**${ROLE_HEADINGS[role]} (${entries.length}/${settings.targets[i]})**`, ...lines, '']
  })

  return [
    `**${escapeDiscord(guild.name)} · raid roster · week of ${formatMonthDay(currentWeek)}**`,
    `${discordTime(plan.start, 'F')} – ${discordTime(plan.end, 't')}`,
    '',
    ...roleSections,
    ...benchLines(state, players, plan, (text) => `**${text}:**`, escapeDiscord),
  ].join('\n')
}

/**
 * Bench summary: names of players who could fill in, then counts for the rest.
 * Players who cannot come are not listed by name, so nobody reads the bench as "on standby".
 */
function benchLines(state, players, plan, heading, escape) {
  const { available, unavailable, waiting } = benchGroups(players, plan, plan.team)
  const names = available.map((id) => escape(memberById(state, id)?.name ?? '?'))
  const others = [
    unavailable.length && `${unavailable.length} can’t make it`,
    waiting.length && `${waiting.length} haven’t checked in`,
  ].filter(Boolean)
  return [
    `${heading('Bench')} ${names.length ? names.join(', ') : 'nobody else is free'}`,
    ...(others.length ? [`${heading('Not available')} ${others.join(' · ')}`] : []),
  ]
}
