import { ROLES } from './constants.js'
import { characterById } from './model.js'

/** RFC 5545 caps content lines at 75 octets. */
const MAX_OCTETS = 75
const ROLE_HEADINGS = { Tank: 'Tanks', Healer: 'Healers', DPS: 'Damage' }

/** UTC timestamp in iCalendar form, e.g. 20260929T013000Z. */
export function icsTime(ms) {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/** Escape text values: backslash, semicolon, comma, and newlines. */
export function icsEscape(text) {
  return String(text)
    .replace(/[\\;,]/g, '\\$&')
    .replace(/\r?\n/g, '\\n')
}

const encoder = new TextEncoder()

/**
 * Long lines continue on the next line after a single space. Lines are cut by UTF-8 bytes, between
 * whole characters, so names with accents or emoji stay intact and every line fits in 75 octets.
 */
function fold(line) {
  const lines = []
  let current = ''
  let bytes = 0
  for (const char of line) {
    const size = encoder.encode(char).length
    // Continuation lines start with a space, which counts toward their 75 octets.
    const limit = lines.length ? MAX_OCTETS - 1 : MAX_OCTETS
    if (bytes + size > limit) {
      lines.push(current)
      current = ''
      bytes = 0
    }
    current += char
    bytes += size
  }
  return [...lines, current].join('\r\n ')
}

/** "The After Hours" → "the-after-hours", for a UID that is unique per guild. */
function slug(text) {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'guild'
  )
}

function rosterSummary(state, team) {
  return ROLES.map((role) => {
    const names = team
      .filter((e) => e.role === role)
      .map((e) => characterById(state, e.characterId)?.name)
      .filter(Boolean)
    return `${ROLE_HEADINGS[role]}: ${names.length ? names.join(', ') : 'none'}`
  }).join('\n')
}

/**
 * A one-event calendar file for the week's raid. The UID is stable per guild and week, and SEQUENCE
 * grows with each export, so importing an updated file replaces the earlier event instead of adding
 * a second one.
 * @param {{ start: number, end: number, team: import('./engine.js').RosterEntry[] }} plan
 */
export function rosterIcs(state, plan, now = Date.now()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WhenToRaid//Raid planner//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:raid-${state.currentWeek}-${slug(state.guild.name)}@whentoraid`,
    `SEQUENCE:${Math.floor(now / 1000)}`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(plan.start)}`,
    `DTEND:${icsTime(plan.end)}`,
    `SUMMARY:${icsEscape(`${state.guild.name} raid`)}`,
    `DESCRIPTION:${icsEscape(rosterSummary(state, plan.team))}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(fold).join('\r\n')}\r\n`
}
