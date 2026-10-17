/**
 * Signup cards with full-width role sections, bench, tentative and absent players. Complete lists continue
 * in additional messages when necessary; names are never omitted. Never pings.
 */
import { escapeDiscord } from './raid-service-core.js'
import { signupLineup } from './signup-lineup.js'
import { signupReadiness, readinessText } from './raid-readiness.js'
import { listFields, fieldPages } from './discord-lists.js'
import { playerName } from './discord-roster.js'
import { ROLE_HEADINGS, displayRoles, damageSummary } from './raid-presentation.js'
import { specEmojiName } from './spec-icons.js'

/** Class colours from src/lib/constants.js, as the nearest emoji square or heart. */
const CLASS_MARKS = {
  Warrior: '🟫',
  Paladin: '🩷',
  Hunter: '🟩',
  Rogue: '🟨',
  Priest: '⬜',
  Shaman: '🟦',
  Mage: '🩵',
  Warlock: '🟪',
  Druid: '🟧',
}
const COLORS = { open: 0x57f287, published: 0x5865f2, closed: 0x99aab5, cancelled: 0xed4245 }
const FOOTERS = {
  open: 'Press a button to answer · Sign-ups close when the raid starts',
  published: 'Roster published · Sign-ups stay open until the raid starts',
  closed: 'Sign-ups are closed',
  cancelled: 'This raid has been cancelled',
}

export function entryLine(entry, { withRole = false, specEmojis = {} } = {}) {
  const emojiName = specEmojiName(entry.class, entry.spec)
  const emojiId = emojiName && specEmojis[emojiName]
  const mark = /^\d{17,20}$/.test(emojiId ?? '')
    ? `<:${emojiName}:${emojiId}>`
    : Object.hasOwn(CLASS_MARKS, entry.class)
      ? CLASS_MARKS[entry.class]
      : '▫️'
  const build = withRole ? [entry.spec, entry.role].filter(Boolean).join(' ') : (entry.spec ?? '')
  const late = entry.status === 'late' ? ' · late' : ''
  const detail = build ? ` ${escapeDiscord(build)}` : ''
  return `\`${entry.number}\` ${mark} ${playerName(entry, { bold: true })}${detail}${late}`
}

function statusOf(payload) {
  if (payload.cancelled) return 'cancelled'
  if (payload.closed) return 'closed'
  return payload.published ? 'published' : 'open'
}

function describe(payload, lineup, status) {
  const lines = []
  if (payload.start) {
    const seconds = Math.floor(payload.start / 1000)
    lines.push(`🗓️ <t:${seconds}:F>`, `⏰ Starts <t:${seconds}:R>`, '')
  }
  const counts = lineup.roles.map(
    ({ role, target, members }) =>
      `${ROLE_HEADINGS[role]} **${members.length}**${target ? `/${target}` : ''}`,
  )
  lines.push(`${counts.join(' · ')} · **${lineup.coming}** signed up`)
  lines.push(damageSummary(lineup.roles))
  if (status === 'open' || status === 'published')
    lines.push(
      '',
      `**Role check:** ${readinessText(signupReadiness(payload.signups ?? [], payload.targets ?? []))}`,
    )
  if (lineup.bench.length) lines.push(`🪑 ${lineup.bench.length} on the bench`)
  if (!lineup.coming && !lineup.tentative.length && !lineup.absent.length) lines.push('', 'No sign-ups yet.')
  if (status === 'published') lines.push('', '**Roster published.** Check the roster post for your place.')
  else if (status === 'open')
    lines.push('', 'Signup places are provisional. Officers choose the final roster.')
  return lines.join('\n')
}

function lineupFields(lineup, specEmojis) {
  const fields = []
  const add = (name, items, options = {}) => {
    fields.push(...listFields(name, items, options))
  }
  if (lineup.coming) {
    for (const { role, target, members } of displayRoles(lineup.roles)) {
      const count = `${members.length}${target ? `/${target}` : ''}`
      add(
        `${ROLE_HEADINGS[role]} (${count})`,
        members.map((entry) => entryLine(entry, { specEmojis })),
        { joiner: '\n\n' },
      )
    }
  }
  if (lineup.other.length)
    add(
      `❔ No role (${lineup.other.length})`,
      lineup.other.map((entry) => entryLine(entry, { specEmojis })),
      { joiner: '\n\n' },
    )
  add(
    `🪑 Bench (${lineup.bench.length})`,
    lineup.bench.map((entry) => entryLine(entry, { withRole: true, specEmojis })),
    { joiner: '\n\n' },
  )
  for (const [list, label] of [
    [lineup.tentative, '❔ Tentative'],
    [lineup.absent, '❌ Absent'],
  ]) {
    add(
      `${label} (${list.length})`,
      list.map((entry) => playerName(entry)),
      { joiner: ', ' },
    )
  }
  return fields
}

/**
 * One card per message. The delivery worker edits continuations in place, removes surplus pages
 * when lists shrink, and keeps signup buttons on the last message. No player is summarized away.
 */
export function signupMessages(payload, { specEmojis = {} } = {}) {
  const status = statusOf(payload)
  const embed = {
    // Discord shows the author line as plain text (no markdown, no mentions), so it is not escaped.
    author: {
      name: String(payload.guildName ?? '')
        .replace(/[\r\n]/g, ' ')
        .slice(0, 256),
    },
    title: escapeDiscord(payload.raidName).slice(0, 256),
    color: COLORS[status],
    footer: { text: FOOTERS[status] },
    ...(payload.start ? { timestamp: new Date(payload.start).toISOString() } : {}),
  }
  if (status === 'cancelled')
    return [{ content: '', embeds: [{ ...embed, description: '**This raid has been cancelled.**' }] }]
  const lineup = signupLineup(payload.signups ?? [], payload.targets ?? [])
  const pages = fieldPages(lineupFields(lineup, specEmojis))
  return pages.map((fields, index) => ({
    content: '',
    embeds: [
      {
        ...embed,
        description: index
          ? `Signup lists continued · Page ${index + 1}/${pages.length}`
          : describe(payload, lineup, status),
        fields,
        footer: {
          text: pages.length > 1 ? `${FOOTERS[status]} · Page ${index + 1}/${pages.length}` : FOOTERS[status],
        },
      },
    ],
  }))
}
