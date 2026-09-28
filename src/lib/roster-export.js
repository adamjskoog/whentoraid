import { ROLES } from './constants.js'
import { conflicts } from './engine.js'
import { formatSession } from './grid.js'
import { characterById, memberById } from './model.js'
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
  const { guild, settings, currentWeek, members } = state
  const onTeam = new Set(plan.team.map((e) => e.memberId))

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

  const bench = members.filter((m) => !onTeam.has(m.id)).map((m) => escapeDiscord(m.name))
  return [
    `**${escapeDiscord(guild.name)} · raid roster · week of ${formatMonthDay(currentWeek)}**`,
    `${discordTime(plan.start, 'F')} – ${discordTime(plan.end, 't')}`,
    '',
    ...roleSections,
    bench.length ? `**Bench:** ${bench.join(', ')}` : '**Bench:** none',
  ].join('\n')
}
