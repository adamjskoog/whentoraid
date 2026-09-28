import { describe, expect, test } from 'vitest'
import { saveCharacter } from './model.js'
import { plannerContext } from './planning.js'
import { DISCORD_MESSAGE_LIMIT, escapeDiscord, rosterDiscord, rosterText } from './roster-export.js'
import { createSeedState } from './seed.js'

describe('rosterText', () => {
  test('lists each assignment with its window', () => {
    const state = createSeedState()
    const { plan, players } = plannerContext(state)
    const text = rosterText(state, plan, players)
    expect(text).toContain('WhenToRaid — week of 2026-09-28')
    expect(text).toContain('Fri · ')
    expect(text.split('\n')).toHaveLength(3 + plan.team.length)
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
    expect(text).toContain('**Tanks (2/2)**')
    expect(text).toContain('**Healers (4/4)**')
    expect(text).toContain('**Damage (14/14)**')
    expect(text).toContain('- Stoneguard (Adam) · Protection Warrior')
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

describe('escapeDiscord', () => {
  test('escapes markdown and breaks every mention form', () => {
    expect(escapeDiscord('a_b|c`d~e>f')).toBe('a\\_b\\|c\\`d\\~e\\>f')
    expect(escapeDiscord('<@123> @here [x](y)')).toBe('\\<@\u200b123\\> @\u200bhere \\[x\\](y)')
  })
})
