import { describe, expect, test } from 'vitest'
import { createSeedState, SEED_WEEK } from './seed.js'
import { plannerContext, rebuildTeam } from './planning.js'
import { setPlan, getWeek } from './model.js'
import { setCurrentRaid } from './raids.js'
import { publicationChanges, publicationIssues, publishPlan } from './raid-workflow.js'
import { markAllAttended, setAttendance, setCancelled } from './attendance.js'
import { isAvailable } from './engine.js'

function publishedSeed() {
  const state = createSeedState()
  const { plan, players } = plannerContext(state)
  return publishPlan(state, plan, players, 1000).state
}

describe('published commitments', () => {
  test('suggestions and rebuilds omit players in another published raid but allow adjacent sessions', () => {
    const state = publishedSeed()
    const published = getWeek(state, SEED_WEEK).plan.published
    const { players, suggestions } = plannerContext(setCurrentRaid(state, 'raid-10-1'))
    const booked = new Set(published.team.map((entry) => entry.memberId))
    for (const suggestion of suggestions.filter((s) => s.start < published.end && s.end > published.start)) {
      expect(suggestion.team.every((e) => !booked.has(e.memberId))).toBe(true)
    }
    expect(rebuildTeam(players, published, [2, 2, 6], [], []).every((e) => !booked.has(e.memberId))).toBe(
      true,
    )
    const player = players.find((p) => booked.has(p.id))
    expect(
      isAvailable(
        { ...player, ranges: [{ start: published.end, end: published.end + 3600000 }] },
        {
          start: published.end,
          end: published.end + 3600000,
        },
      ),
    ).toBe(true)
  })

  test('drafts and cancelled raids do not reserve players; a raid never conflicts with itself', () => {
    const state = publishedSeed()
    const { plan, players } = plannerContext(state)
    expect(publicationIssues(state, plan, players)).toEqual([])
    const cancelled = setCancelled(state, SEED_WEEK, true)
    const next = plannerContext(setCurrentRaid(cancelled, 'raid-10-1'))
    expect(next.players.every((p) => p.commitments.length === 0)).toBe(true)
  })
})

describe('publication review', () => {
  test('names removed, added, changed characters/roles and time changes', () => {
    const state = publishedSeed()
    const { plan } = plannerContext(state)
    const first = plan.team[0]
    const next = {
      ...plan,
      start: plan.start + 1800000,
      end: plan.end + 1800000,
      team: [{ ...first, role: 'DPS' }, ...plan.team.slice(2)],
    }
    const changes = publicationChanges(state, next)
    expect(changes.map((c) => c.kind)).toEqual(expect.arrayContaining(['time', 'changed', 'removed']))
    expect(changes.find((c) => c.kind === 'changed').memberId).toBe(first.memberId)
    expect(publicationChanges(state, plan)).toEqual([])
  })

  test('issues identify the affected player and the overlapping raid', () => {
    const state = publishedSeed()
    const published = getWeek(state, SEED_WEEK).plan.published
    const other = setPlan(setCurrentRaid(state, 'raid-10-1'), SEED_WEEK, {
      start: published.start,
      team: published.team.slice(0, 1),
    })
    const { plan, players } = plannerContext(other)
    const issue = publicationIssues(other, plan, players).find((i) => i.kind === 'overlap')
    expect(issue).toMatchObject({ memberId: published.team[0].memberId, raidId: 'raid-20' })
    expect(issue.message).toContain(state.members.find((m) => m.id === issue.memberId).name)
    expect(publishPlan(other, plan, players).error).toMatch(/overlapping players/)
  })
})

describe('bulk attendance', () => {
  test('fills unrecorded attendees while preserving late/no-show exceptions and other raids', () => {
    let state = publishedSeed()
    state = setAttendance(state, SEED_WEEK, 'm0', 'noshow')
    const after = markAllAttended(state, SEED_WEEK)
    const plan = getWeek(after, SEED_WEEK).plan
    expect(plan.attendance.m0).toBe('noshow')
    expect(Object.keys(plan.attendance)).toHaveLength(plan.team.length)
    expect(getWeek(state, SEED_WEEK).plan.attendance).toEqual({ m0: 'noshow' })
    expect(markAllAttended(setCancelled(state, SEED_WEEK, true), SEED_WEEK).weeks).toEqual(
      setCancelled(state, SEED_WEEK, true).weeks,
    )
  })
})
