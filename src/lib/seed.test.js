import { describe, expect, test } from 'vitest'
import { createDemoState } from './seed.js'
import { enginePlayers, pruneOldWeeks } from './model.js'
import { isAvailable } from './engine.js'
import { parseBackup, backupJson } from './storage.js'
import { addDays, mondayOf } from './time.js'

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

describe('full-year randomized demo', () => {
  const now = Date.UTC(2026, 9, 5, 18)

  test('fills every week touching the calendar year with valid independent raid rosters', () => {
    const state = createDemoState({ now, random: rng(1) })
    expect(state.currentWeek).toBe('2026-10-05')
    expect(state.demoYear).toBe(2026)
    for (let week = mondayOf('2026-01-01'); week <= '2026-12-31'; week = addDays(week, 7)) {
      const data = state.weeks[week]
      expect(Object.keys(data.checkins)).toHaveLength(24)
      expect(Object.keys(data.plans)).toHaveLength(3)
      const players = enginePlayers(state, week)
      for (const raid of state.settings.raids) {
        const plan = data.plans[raid.id]
        const window = { start: plan.start, end: plan.start + raid.durationSlots * 1800000 }
        expect(plan.team.length).toBeLessThanOrEqual(raid.size)
        expect(new Set(plan.team.map((e) => e.memberId)).size).toBe(plan.team.length)
        expect(
          plan.team.every((e) =>
            isAvailable(
              players.find((p) => p.id === e.memberId),
              window,
            ),
          ),
        ).toBe(true)
        if (window.end >= now) expect(plan.attendance).toEqual({})
      }
    }
    expect(pruneOldWeeks(state, state.currentWeek)).toBe(state)
    expect(parseBackup(backupJson(state)).state).toEqual(state)
  })

  test('each random seed changes weekly availability and rosters', () => {
    const a = createDemoState({ now, random: rng(17) })
    const b = createDemoState({ now, random: rng(32) })
    expect(a.weeks).not.toEqual(b.weeks)
    expect(a.weeks[a.currentWeek].checkins).not.toEqual(b.weeks[b.currentWeek].checkins)
    expect(a.weeks[a.currentWeek].plans).not.toEqual(b.weeks[b.currentWeek].plans)
  })

  test('uses the guild timezone at the year boundary and includes leap day', () => {
    const state = createDemoState({ now: Date.UTC(2029, 0, 1, 1), random: rng(3) })
    expect(state.demoYear).toBe(2028)
    expect(state.weeks[mondayOf('2028-02-29')]).toBeDefined()
    expect(state.weeks[mondayOf('2028-12-31')]).toBeDefined()
  })
})
