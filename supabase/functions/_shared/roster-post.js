/**
 * Published roster cards with full-width role sections and talent spec icons.
 * Pings go in the message text, because Discord never pings from an embed, and edits never ping
 * again (see deliverMessages). Complete lists continue in additional messages; no name is dropped.
 */
import { escapeDiscord } from './raid-service-core.js'
import { entryLine } from './signup-post.js'
import { ROLE_HEADINGS, displayRoles, damageSummary } from './raid-presentation.js'
import { SIGNUP_ROLES } from './signup-lineup.js'
import { roleNeeds } from './raid-readiness.js'
import { listFields, fieldPages } from './discord-lists.js'

/** Discord accepts at most 100 user mentions, and 2000 characters, per message. */
const MAX_MENTIONS = 100
const MAX_CONTENT = 2000
const COLORS = { published: 0x5865f2, withdrawn: 0x99aab5, cancelled: 0xed4245 }
const FOOTERS = {
  published: 'Published roster · Choose Confirm, Tentative, or Can’t attend',
  withdrawn: 'Roster withdrawn',
  cancelled: 'This raid has been cancelled',
}
const CLOSED = {
  withdrawn: '**This roster has been withdrawn. Await a new published roster.**',
  cancelled: '**This raid has been cancelled.**',
}

function statusOf(payload) {
  if (payload.cancelled) return 'cancelled'
  return payload.withdrawn ? 'withdrawn' : 'published'
}

/** Players grouped by role in published order, numbered down the card. */
function lineup(payload) {
  const team = payload.team ?? []
  let count = 0
  const numbered = (entry) => ({ ...entry, number: ++count })
  const budgetRoles = SIGNUP_ROLES.map((role, i) => ({
    role,
    target: Math.max(0, Math.floor(Number(payload.targets?.[i]) || 0)),
    members: team.filter((entry) => entry.role === role),
  }))
  const roles = displayRoles(budgetRoles).map((group) => ({ ...group, members: group.members.map(numbered) }))
  const other = team.filter((entry) => !SIGNUP_ROLES.includes(entry.role)).map(numbered)
  return { roles, budgetRoles, other, total: count }
}

function describe(payload, { budgetRoles, total }) {
  const seconds = Math.floor(payload.start / 1000)
  const counts = budgetRoles.map(
    ({ role, target, members }) =>
      `${ROLE_HEADINGS[role]} **${members.length}**${target ? `/${target}` : ''}`,
  )
  const needed = roleNeeds(
    budgetRoles.map(({ role, target, members }) => ({ role, missing: Math.max(0, target - members.length) })),
  )
  return [
    `🗓️ <t:${seconds}:F>`,
    `⏰ Starts <t:${seconds}:R>`,
    '',
    `${counts.join(' · ')} · **${total}** rostered`,
    damageSummary(budgetRoles),
    '',
    needed ? `**Still needed:** ${needed}` : 'All role targets filled.',
  ].join('\n')
}

function rosterFields({ roles, other }, specEmojis) {
  const fields = roles.flatMap(({ role, target, members }) =>
    listFields(
      `${ROLE_HEADINGS[role]} (${members.length}${target ? `/${target}` : ''})`,
      members.map((entry) => entryLine(entry, { specEmojis })),
      { joiner: '\n\n' },
    ),
  )
  if (other.length)
    fields.push(
      ...listFields(
        `❔ No role (${other.length})`,
        other.map((entry) => entryLine(entry, { specEmojis })),
        { joiner: '\n\n' },
      ),
    )
  return fields
}

/** As many valid mentions as fit in one message's text. */
function pingLine(mentionIds) {
  const pings = []
  let length = '**Raiders:**'.length
  for (const id of mentionIds.filter((id) => /^\d{17,20}$/.test(id)).slice(0, MAX_MENTIONS)) {
    if (length + id.length + 4 > MAX_CONTENT) break
    pings.push(`<@${id}>`)
    length += id.length + 4
  }
  return pings.length ? `**Raiders:** ${pings.join(' ')}` : ''
}

/** `mentionIds`: players to ping (only on the first post; edits never ping again). */
export function rosterMessages(payload, mentionIds = [], { specEmojis = {} } = {}) {
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
  if (status !== 'published') return [{ content: '', embeds: [{ ...embed, description: CLOSED[status] }] }]
  const groups = lineup(payload)
  const pages = fieldPages(rosterFields(groups, specEmojis))
  return pages.map((fields, index) => ({
    content: index ? '' : pingLine(mentionIds),
    embeds: [
      {
        ...embed,
        description: index
          ? `Roster continued · Page ${index + 1}/${pages.length}`
          : describe(payload, groups),
        fields,
        footer: {
          text: pages.length > 1 ? `${FOOTERS[status]} · Page ${index + 1}/${pages.length}` : FOOTERS[status],
        },
      },
    ],
  }))
}
