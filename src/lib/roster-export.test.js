import { describe, expect, test } from 'vitest'
import { characterById, getCheckin, saveCharacter } from './model.js'
import { plannerContext } from './planning.js'
import {
  DISCORD_MESSAGE_LIMIT,
  escapeDiscord,
  rosterDiscord,
  rosterMentions,
  rosterText,
  splitForDiscord,
} from './roster-export.js'
import { createSeedState } from './seed.js'

describe('rosterText', () => {
  test('lists each assignment with its window', () => {
    const state = createSeedState()
    const { plan, players } = plannerContext(state)
    const text = rosterText(state, plan, players)
    expect(text).toContain('WhenToRaid — week of 2026-09-28')
    expect(text).toContain('Fri · ')
    const rosterLines = text.split('\n').filter((line) => /^(Tank|Healer|DPS): /.test(line))
    expect(rosterLines).toHaveLength(plan.team.length)
    expect(text).toMatch(/^Bench: /m)
  })
})

describe('a spec chosen at Discord sign-up', () => {
  test('is the spec both exports show for that player in this raid', () => {
    const base = createSeedState()
    const { plan, players } = plannerContext(base)
    const [entry] = plan.team
    const checkin = getCheckin(base, base.currentWeek, entry.memberId)
    const week = base.weeks[base.currentWeek]
    const signedAs = { characterId: entry.characterId, spec: 'Signed Spec', role: entry.role }
    const state = {
      ...base,
      weeks: {
        ...base.weeks,
        [base.currentWeek]: {
          ...week,
          checkins: {
            ...week.checkins,
            [entry.memberId]: {
              ...checkin,
              raids: { [base.currentRaidId]: { participating: true, declined: [], signedAs } },
            },
          },
        },
      },
    }
    const { class: className } = characterById(state, entry.characterId)
    expect(rosterText(state, plan, players)).toContain(`Signed Spec ${className}`)
    expect(rosterDiscord(state, plan, players)).toContain(`Signed Spec ${className}`)
  })
})

describe('rosterDiscord', () => {
  test('uses Discord timestamps so each reader sees their own timezone', () => {
    const state = createSeedState()
    const { plan, players } = plannerContext(state)
    const text = rosterDiscord(state, plan, players)
    expect(text).toContain(`<t:${plan.start / 1000}:F> – <t:${plan.end / 1000}:t>`)
  })

  test('groups by role with counts, lists the bench, and fits in one Discord message', () => {
    const state = createSeedState()
    const { plan, players } = plannerContext(state)
    const text = rosterDiscord(state, plan, players)
    expect(text).toContain('🛡️ **Tanks (2/2)**')
    expect(text).toContain('💚 **Healers (4/4)**')
    expect(text).toContain('⚔️ **Damage (14/14)**')
    expect(text).toContain('- 🟫 Stoneguard (Adam) · Protection Warrior')
    expect(text).toMatch(/^- 🩵 \S+ \(\w+\) · Frost Mage$/m)
    expect(text).toMatch(/\*\*Bench:\*\* \w+/)
    expect(text.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT)
  })

  test('player-entered names cannot format text or ping anyone', () => {
    const input = {
      id: 'c0a',
      name: '@everyone *x*',
      realm: 'Whitemane',
      class: 'Warrior',
      spec: 'Protection',
      role: 'Tank',
    }
    const { state } = saveCharacter(createSeedState(), 'm0', input)
    const { plan, players } = plannerContext(state)
    const text = rosterDiscord(state, plan, players)
    expect(text).not.toContain('@everyone')
    expect(text).toContain('@\u200beveryone \\*x\\*')
  })
})

describe('rosterMentions', () => {
  test('mentions each rostered player with a Discord ID once, and nobody else', () => {
    const seed = createSeedState()
    const { plan } = plannerContext(seed)
    const [first, second] = plan.team
    const benched = seed.members.find((m) => !plan.team.some((e) => e.memberId === m.id))
    const ids = { [first.memberId]: '511111111111111111', [benched.id]: '533333333333333333' }
    const state = { ...seed, members: seed.members.map((m) => ({ ...m, discordId: ids[m.id] ?? '' })) }
    const result = rosterMentions(state, { ...plan, team: [first, first, second] })
    expect(result).toEqual({ ids: ['511111111111111111'], line: '**Raiders:** <@511111111111111111>' })
  })

  test('no line when nobody has a Discord ID', () => {
    const state = createSeedState()
    expect(rosterMentions(state, plannerContext(state).plan)).toEqual({ ids: [], line: '' })
  })
})

describe('splitForDiscord', () => {
  const CONTINUED = '*(continued)*\n'
  const sections = (count, linesEach, width) =>
    Array.from({ length: count }, (_, s) =>
      Array.from({ length: linesEach }, (_, l) => `S${s}L${l} ${'x'.repeat(width)}`).join('\n'),
    ).join('\n\n')

  test('text within the limit is one message, unchanged', () => {
    expect(splitForDiscord('hello\n\nworld')).toEqual(['hello\n\nworld'])
  })

  test('long text splits between sections, every message fits, and nothing is lost', () => {
    const text = sections(6, 8, 40)
    const parts = splitForDiscord(text, 1000)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(1000)
    expect(parts.slice(1).every((p) => p.startsWith(CONTINUED))).toBe(true)
    expect(parts.map((p) => p.replace(CONTINUED, '')).join('\n\n')).toBe(text)
  })

  test('a section longer than one message splits between lines, never inside one', () => {
    const text = sections(1, 60, 40)
    const parts = splitForDiscord(text, 500)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(500)
    const lines = parts.flatMap((p) => p.replace(CONTINUED, '').split('\n'))
    expect(lines).toEqual(text.split('\n'))
  })
})

describe('escapeDiscord', () => {
  test('escapes markdown and breaks every mention form', () => {
    expect(escapeDiscord('a_b|c`d~e>f')).toBe('a\\_b\\|c\\`d\\~e\\>f')
    expect(escapeDiscord('<@123> @here [x](y)')).toBe('\\<@\u200b123\\> @\u200bhere \\[x\\](y)')
  })
})
