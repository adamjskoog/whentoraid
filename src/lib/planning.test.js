import { describe, expect, test } from 'vitest'
import { getWeek, setCurrentWeek, setPlan } from './model.js'
import {
  applySettings,
  benchHistory,
  placeInRoster,
  plannerContext,
  rankSuggestions,
  rebuildTeam,
  toggleLock,
  topDistinctDays,
} from './planning.js'
import { addDays } from './time.js'
import { createSeedState, SEED_WEEK } from './seed.js'

describe('plannerContext', () => {
  test('without a saved plan, uses the top suggestion (Friday for the sample guild)', () => {
    const { plan, suggestions } = plannerContext(createSeedState())
    expect(plan.saved).toBe(false)
    expect(plan.day).toBe(4)
    expect(plan.team).toEqual(suggestions[0].team)
    expect(new Set(plan.team.map((e) => e.memberId)).size).toBe(plan.team.length)
  })

  test('a saved plan wins over suggestions', () => {
    const initial = createSeedState()
    const { windows } = plannerContext(initial)
    const monday = windows.find((w) => w.day === 0 && w.startSlot === 0)
    const state = setPlan(initial, SEED_WEEK, { start: monday.start, team: [] })
    expect(plannerContext(state).plan).toMatchObject({ day: 0, startSlot: 0, team: [], saved: true })
  })

  test('topDistinctDays picks one suggestion per day', () => {
    const { suggestions } = plannerContext(createSeedState())
    const picked = topDistinctDays(suggestions, 3)
    expect(picked).toHaveLength(3)
    expect(new Set(picked.map((s) => s.day)).size).toBe(3)
  })
})

describe('placeInRoster', () => {
  const team = [
    { memberId: 'a', characterId: 'a1', role: 'Tank' },
    { memberId: 'b', characterId: 'b1', role: 'Healer' },
  ]

  test('moves a member rather than duplicating them', () => {
    const result = placeInRoster(team, { memberId: 'a', characterId: 'a2', role: 'Healer' }, [1, 2, 0])
    expect(result.team).toEqual([team[1], { memberId: 'a', characterId: 'a2', role: 'Healer' }])
  })

  test('refuses a full role', () => {
    expect(placeInRoster(team, { memberId: 'c', characterId: 'c1', role: 'Tank' }, [1, 2, 0])).toEqual({
      error: 'Tank slots are full. Move someone to the bench first.',
    })
  })
})

describe('applySettings', () => {
  test('keeps the session inside the day and rebuilds within the new caps', () => {
    const initial = createSeedState()
    const { windows } = plannerContext(initial)
    const late = windows.find((w) => w.day === 4 && w.startSlot === 18)
    const state = setPlan(initial, SEED_WEEK, { start: late.start, team: [] })

    const input = { targets: [1, 1, 2], durationSlots: 8, discordServerId: '', officerRoleIds: '' }
    const { state: next, error } = applySettings(state, input)
    expect(error).toBeUndefined()

    const { plan } = plannerContext(next)
    expect(plan).toMatchObject({ day: 4, startSlot: 16, saved: true })
    expect(plan.team.length).toBeLessThanOrEqual(4)
  })

  test('returns the validation error and leaves state alone', () => {
    const state = createSeedState()
    const input = { targets: [0, 0, 0], durationSlots: 6, discordServerId: '', officerRoleIds: '' }
    expect(applySettings(state, input).state).toBe(state)
  })
})

const NEXT_WEEK = addDays(SEED_WEEK, 7)
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Seed guild with last week's Friday plan saved, and this week's check-ins copied from last week. */
function stateWithLastWeekPlanned() {
  const seed = createSeedState()
  const { plan } = plannerContext(seed)
  const planned = setPlan(seed, SEED_WEEK, { start: plan.start, team: plan.team })
  const shifted = Object.fromEntries(
    Object.entries(getWeek(planned, SEED_WEEK).checkins).map(([id, c]) => [
      id,
      { ...c, ranges: c.ranges.map((r) => ({ start: r.start + WEEK_MS, end: r.end + WEEK_MS })) },
    ]),
  )
  const state = setCurrentWeek(
    { ...planned, weeks: { ...planned.weeks, [NEXT_WEEK]: { checkins: shifted, plan: null } } },
    NEXT_WEEK,
  )
  const benchedLastWeek = seed.members
    .map((m) => m.id)
    .filter((id) => !plan.team.some((e) => e.memberId === id))
  return { state, benchedLastWeek }
}

describe('bench fairness', () => {
  test('benchHistory counts members who were free but left off a past roster', () => {
    const { state, benchedLastWeek } = stateWithLastWeekPlanned()
    const history = benchHistory(state, NEXT_WEEK)
    expect(benchedLastWeek.length).toBeGreaterThan(0)
    expect([...history.keys()].sort()).toEqual([...benchedLastWeek].sort())
    expect([...history.values()].every((n) => n === 1)).toBe(true)
  })

  test('weeks without a saved plan and weeks outside the lookback are ignored', () => {
    const { state } = stateWithLastWeekPlanned()
    expect(benchHistory(state, addDays(SEED_WEEK, 7 * 5)).size).toBe(0)
    expect(benchHistory(createSeedState(), NEXT_WEEK).size).toBe(0)
  })

  test("this week's suggested roster brings in last week's bench", () => {
    const { state, benchedLastWeek } = stateWithLastWeekPlanned()
    const { plan, players } = plannerContext(state)
    expect(
      players
        .filter((p) => p.priority > 0)
        .map((p) => p.id)
        .sort(),
    ).toEqual([...benchedLastWeek].sort())
    const rostered = new Set(plan.team.map((e) => e.memberId))
    expect(benchedLastWeek.filter((id) => !rostered.has(id))).toEqual([])
  })
})

describe('rankSuggestions', () => {
  const dps = (id, ranges) => ({
    id,
    checkedIn: true,
    ranges,
    characters: [{ id: `${id}c`, role: 'DPS', main: true, offered: true }],
  })

  test('with equal slots filled, the window with more backups ranks first even if it is later', () => {
    const early = { day: 0, startSlot: 0, start: 0, end: 10 }
    const late = { day: 3, startSlot: 0, start: 100, end: 110 }
    const players = [dps('a', [{ start: 0, end: 110 }]), dps('b', [{ start: 100, end: 110 }])]
    const ranked = rankSuggestions([early, late], players, [0, 0, 1])
    expect(ranked.map((s) => s.day)).toEqual([3, 0])
    expect(ranked[0]).toMatchObject({ backups: [0, 0, 1], thinnest: 1 })
  })

  test('backups in a role the raid does not need do not count toward the thinnest role', () => {
    const window = { day: 0, startSlot: 0, start: 0, end: 10 }
    const [s] = rankSuggestions(
      [window],
      [dps('a', [{ start: 0, end: 10 }]), dps('b', [{ start: 0, end: 10 }])],
      [0, 0, 1],
    )
    expect(s.thinnest).toBe(1)
  })
})

describe('locks', () => {
  test('rebuildTeam keeps a locked member the optimizer would otherwise drop', () => {
    const state = createSeedState()
    const { plan, players } = plannerContext(state)
    const dpsEntries = plan.team.filter((e) => e.role === 'DPS')
    const keep = dpsEntries.at(-1)
    const team = rebuildTeam(players, plan, [0, 0, 1], plan.team, [keep.memberId])
    expect(team).toEqual([keep])
  })

  test('applySettings rebuilds around locked members and keeps their locks', () => {
    const initial = createSeedState()
    const { plan } = plannerContext(initial)
    const keep = plan.team.filter((e) => e.role === 'DPS').at(-1)
    const state = setPlan(initial, SEED_WEEK, { start: plan.start, team: plan.team, locked: [keep.memberId] })

    const input = { targets: [2, 4, 1], durationSlots: 6, discordServerId: '', officerRoleIds: '' }
    const next = plannerContext(applySettings(state, input).state).plan
    expect(next.team.filter((e) => e.role === 'DPS')).toEqual([keep])
    expect(next.locked).toEqual([keep.memberId])
  })

  test('setPlan drops locks for members no longer on the team', () => {
    const team = [{ memberId: 'm1', characterId: 'c1a', role: 'Tank' }]
    const state = setPlan(createSeedState(), SEED_WEEK, { start: 0, team, locked: ['m1', 'm2'] })
    expect(getWeek(state, SEED_WEEK).plan.locked).toEqual(['m1'])
  })

  test('toggleLock adds and removes', () => {
    expect(toggleLock(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleLock(['a', 'b'], 'a')).toEqual(['b'])
  })
})
