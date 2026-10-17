/**
 * The Raid-Helper-style sign-up card: one Discord embed with the raid time, a column per role
 * numbered in sign-up order, the bench, and tentative and absent players. Never pings.
 */
import { escapeDiscord } from './raid-service-core.js'
import { signupLineup } from './signup-lineup.js'

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
const ROLE_HEADINGS = { Tank: '🛡️ Tanks', Healer: '💚 Healers', DPS: '⚔️ DPS' }
const COLORS = { open: 0x57f287, published: 0x5865f2, closed: 0x99aab5, cancelled: 0xed4245 }
const FOOTERS = {
  open: 'Press a button to answer · Sign-ups close when the raid starts',
  published: 'Roster published · Sign-ups stay open until the raid starts',
  closed: 'Sign-ups are closed',
  cancelled: 'This raid has been cancelled',
}

/** Discord's embed limits, leaving room for the title, description and footer within 6000. */
const FIELD_LIMIT = 1024
const MAX_FIELDS = 25
const FIELDS_BUDGET = 5000

function entryLine(entry, { withRole = false } = {}) {
  const mark = CLASS_MARKS[entry.class] ?? '▫️'
  const build = withRole ? [entry.spec, entry.role].filter(Boolean).join(' ') : (entry.spec ?? '')
  const late = entry.status === 'late' ? ' · late' : ''
  const detail = build ? ` ${escapeDiscord(build)}` : ''
  return `\`${entry.number}\` ${mark} **${escapeDiscord(entry.name)}**${detail}${late}`
}

/**
 * Fields for one list: each value within Discord's field limit (continuations get an invisible
 * name), all of them within `budget` characters. What does not fit becomes "…and N more".
 */
function listFields(name, items, { inline = false, joiner = '\n', budget }) {
  const values = []
  let value = ''
  let used = name.length
  for (const [i, item] of items.entries()) {
    const more = `…and ${items.length - i} more`
    if (used + joiner.length + item.length + joiner.length + more.length > budget) {
      // The summary must never be cut short, so it starts a new field when this one is full.
      if (value && value.length + joiner.length + more.length > FIELD_LIMIT) {
        values.push(value)
        value = ''
      }
      value += (value ? joiner : '') + more
      break
    }
    if (value && value.length + joiner.length + item.length > FIELD_LIMIT) {
      values.push(value)
      value = ''
    }
    used += (value ? joiner.length : 1) + item.length
    value += (value ? joiner : '') + item
  }
  values.push(value || '—')
  return values.map((text, i) => ({ name: i ? '​' : name, value: text.slice(0, FIELD_LIMIT), inline }))
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
  if (lineup.bench.length) lines.push(`🪑 ${lineup.bench.length} on the bench`)
  if (!lineup.coming && !lineup.tentative.length && !lineup.absent.length) lines.push('', 'No sign-ups yet.')
  if (status === 'published') lines.push('', '**Roster published.** Check the roster post for your place.')
  return lines.join('\n')
}

function lineupFields(lineup) {
  let budget = FIELDS_BUDGET
  const fields = []
  const add = (name, items, options = {}) => {
    if (budget <= name.length || fields.length >= MAX_FIELDS) return
    const next = listFields(name, items, { ...options, budget }).slice(0, MAX_FIELDS - fields.length)
    budget -= next.reduce((sum, field) => sum + field.name.length + field.value.length, 0)
    fields.push(...next)
  }
  if (lineup.coming) {
    for (const { role, target, members } of lineup.roles) {
      const count = `${members.length}${target ? `/${target}` : ''}`
      add(
        `${ROLE_HEADINGS[role]} (${count})`,
        members.map((entry) => entryLine(entry)),
        { inline: true },
      )
    }
  }
  if (lineup.other.length)
    add(
      `❔ No role (${lineup.other.length})`,
      lineup.other.map((entry) => entryLine(entry)),
      { inline: true },
    )
  if (lineup.bench.length)
    add(
      `🪑 Bench (${lineup.bench.length})`,
      lineup.bench.map((entry) => entryLine(entry, { withRole: true })),
    )
  for (const [list, label] of [
    [lineup.tentative, '❔ Tentative'],
    [lineup.absent, '❌ Absent'],
  ]) {
    if (list.length)
      add(
        `${label} (${list.length})`,
        list.map((entry) => escapeDiscord(entry.name)),
        { joiner: ', ' },
      )
  }
  return fields
}

/**
 * The sign-up card as one message, `{ content, embeds }`. Content is empty so an edit also clears
 * the text of a post made before cards existed.
 */
export function signupMessages(payload) {
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
  const card = { ...embed, description: describe(payload, lineup, status), fields: lineupFields(lineup) }
  return [{ content: '', embeds: [card] }]
}
