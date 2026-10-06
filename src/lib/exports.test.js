import { describe, expect, test } from 'vitest'
import { icsEscape, icsTime, rosterIcs } from './calendar.js'
import { nextCell } from './grid-nav.js'
import { markUnavailable } from './model.js'
import { benchGroups, formatMissing, missingRoles, plannerContext } from './planning.js'
import { rosterDiscord, rosterText } from './roster-export.js'
import { createSeedState, SEED_WEEK } from './seed.js'

describe('calendar export', () => {
  test('formats UTC times and escapes text', () => {
    expect(icsTime(Date.UTC(2026, 8, 29, 1, 30))).toBe('20260929T013000Z')
    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
  })

  test('produces one event with a stable UID, CRLF line endings, and folded lines', () => {
    const state = createSeedState()
    const { plan } = plannerContext(state)
    const ics = rosterIcs(state, plan, Date.UTC(2026, 8, 28))
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain(`UID:raid-${SEED_WEEK}-the-after-hours@whentoraid`)
    expect(ics).toMatch(/\r\nSEQUENCE:\d+\r\n/)
    expect(ics).toContain(`DTSTART:${icsTime(plan.start)}`)
    expect(ics).toContain(`DTEND:${icsTime(plan.end)}`)
    expect(ics).toContain('SUMMARY:The After Hours — 20-player Raid')
    expect(ics.split('\r\n').every((line) => line.length <= 75)).toBe(true)
    // Unfolding restores the roster description.
    expect(ics.replace(/\r\n /g, '')).toContain('Tanks: Stoneguard')
  })
})

describe('calendar folding with non-ASCII text', () => {
  test('lines stay within 75 UTF-8 bytes and never split a character', () => {
    const seed = createSeedState()
    const state = { ...seed, guild: { ...seed.guild, name: '⚔️ Ночная смена 夜勤 '.repeat(4) } }
    const { plan } = plannerContext(state)
    const ics = rosterIcs(state, plan, 0)
    const encoder = new TextEncoder()
    for (const line of ics.split('\r\n')) expect(encoder.encode(line).length).toBeLessThanOrEqual(75)
    // A split surrogate pair would turn into U+FFFD once encoded as UTF-8.
    expect(new TextDecoder().decode(encoder.encode(ics))).not.toContain('�')
    expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${state.guild.name} — 20-player Raid`)
  })
})

describe('missing roles', () => {
  test('lists shortfalls in role order and words them', () => {
    const team = [{ memberId: 'm0', characterId: 'c0a', role: 'Healer' }]
    const missing = missingRoles(team, [1, 3, 0])
    expect(missing).toEqual([
      { role: 'Tank', missing: 1 },
      { role: 'Healer', missing: 2 },
    ])
    expect(formatMissing(missing)).toBe('Short 1 tank, 2 healers')
    expect(formatMissing([{ role: 'DPS', missing: 1 }])).toBe('Short 1 damage dealer')
    expect(formatMissing([])).toBeNull()
  })
})

describe('bench groups and exports', () => {
  test('splits members off the roster into available, can’t make it, and not checked in', () => {
    const state = markUnavailable(createSeedState(), SEED_WEEK, 'm23')
    const { plan, players } = plannerContext(state)
    const benched = players.find((p) => p.id !== 'm23' && !plan.team.some((e) => e.memberId === p.id))
    const notCheckedIn = players.map((p) => (p.id === benched.id ? { ...p, checkedIn: false } : p))
    const groups = benchGroups(notCheckedIn, plan, plan.team)
    expect(groups.unavailable).toContain('m23')
    expect(groups.waiting).toEqual([benched.id])
    const total = groups.available.length + groups.unavailable.length + groups.waiting.length
    expect(total).toBe(players.length - plan.team.length)
  })

  test('the Discord bench names only players who could fill in', () => {
    const state = markUnavailable(createSeedState(), SEED_WEEK, 'm23')
    const { plan, players } = plannerContext(state)
    const text = rosterDiscord(state, plan, players)
    const benchLine = text.split('\n').find((l) => l.startsWith('**Bench:**'))
    expect(benchLine).not.toContain('Flint')
    expect(text).toMatch(/\*\*Not available:\*\* \d+ can’t make it/)
    expect(rosterText(state, plan, players)).toMatch(/Not available: \d+ can’t make it/)
  })
})

describe('grid keyboard navigation', () => {
  test('arrows move by slot and day and stop at the edges', () => {
    expect(nextCell({ day: 2, slot: 5 }, 'ArrowDown', 24)).toEqual({ day: 2, slot: 6 })
    expect(nextCell({ day: 2, slot: 5 }, 'ArrowLeft', 24)).toEqual({ day: 1, slot: 5 })
    expect(nextCell({ day: 0, slot: 0 }, 'ArrowUp', 24)).toEqual({ day: 0, slot: 0 })
    expect(nextCell({ day: 6, slot: 23 }, 'ArrowRight', 24)).toEqual({ day: 6, slot: 23 })
    expect(nextCell({ day: 6, slot: 23 }, 'ArrowDown', 24)).toEqual({ day: 6, slot: 23 })
  })

  test('Home and End jump within the day; other keys do nothing', () => {
    expect(nextCell({ day: 3, slot: 9 }, 'Home', 24)).toEqual({ day: 3, slot: 0 })
    expect(nextCell({ day: 3, slot: 9 }, 'End', 12)).toEqual({ day: 3, slot: 11 })
    expect(nextCell({ day: 3, slot: 9 }, 'a', 24)).toBeNull()
  })
})
