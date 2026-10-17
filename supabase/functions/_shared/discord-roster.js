import { escapeDiscord } from './raid-service-core.js'
import { signupLineup } from './signup-lineup.js'
import { fieldPages, listFields } from './discord-lists.js'
import { damageType } from './raid-presentation.js'

/** Include both character and player names whenever they differ, without exposing Discord IDs. */
export function playerName(entry, { bold = false } = {}) {
  const name = escapeDiscord(entry.name || entry.player || 'Unknown player')
  const player =
    entry.name && entry.player && entry.player !== entry.name ? ` (${escapeDiscord(entry.player)})` : ''
  return `${bold ? `**${name}**` : name}${player}`
}

function entryLine(entry) {
  const type = damageType(entry)
  const role = type && type !== 'Unknown' ? `${type} DPS` : entry.role
  const details = [role, entry.spec, entry.class].filter(Boolean).map(escapeDiscord).join(' · ')
  const status = { late: 'arriving late', tentative: 'tentative', absent: 'marked absent' }[entry.status]
  return `${playerName(entry, { bold: true })}${details ? ` — ${details}` : ''}${status ? ` · ${status}` : ''}`
}

/** Published membership wins over provisional signup order. Signup statuses remain visible separately. */
export function rosterLists(raid) {
  const signups = raid.signups ?? []
  const lineup = signupLineup(signups, raid.targets ?? [])
  const roster = raid.published ? (raid.roster ?? []) : lineup.roles.flatMap(({ members }) => members)
  const selected = new Set(roster.map((entry) => entry.memberId))
  const bench = raid.published
    ? signups.filter((entry) => ['signed', 'late'].includes(entry.status) && !selected.has(entry.memberId))
    : lineup.bench
  return {
    roster,
    bench,
    tentative: lineup.tentative,
    absent: lineup.absent,
    unassigned: raid.published ? [] : lineup.other,
  }
}

/** Complete lists spread over as many private pages as necessary. Empty categories say "None". */
export function rosterPages(raid) {
  const lists = rosterLists(raid)
  const fields = [
    ...listFields(
      `${raid.published ? 'Published roster' : 'Provisional roster'} (${lists.roster.length})`,
      lists.roster.map(entryLine),
    ),
    ...listFields(`Bench (${lists.bench.length})`, lists.bench.map(entryLine)),
    ...listFields(`Tentative (${lists.tentative.length})`, lists.tentative.map(entryLine)),
    ...listFields(`Absent (${lists.absent.length})`, lists.absent.map(entryLine)),
    ...(lists.unassigned.length
      ? listFields(`Role needed (${lists.unassigned.length})`, lists.unassigned.map(entryLine))
      : []),
  ]
  return { lists, pages: fieldPages(fields) }
}
