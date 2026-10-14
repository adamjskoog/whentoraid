import { describe, expect, test } from 'vitest'
import { attentionCount, officerDashboard } from './officer-dashboard.js'
import { createSeedState, SEED_WEEK } from './seed.js'
import { slotWindow } from './grid.js'
import { addDays } from './time.js'

const NOW = Date.parse('2026-09-29T00:00:00Z')
const raidOf = (weeks, weekIso, raidId) =>
  weeks.find((w) => w.weekIso === weekIso).raids.find((r) => r.raidId === raidId)
const codes = (raid) => raid.issues.map((issue) => issue.code)

/** Friday 6 pm guild time in the seed week, when most of the sample guild is free. */
function withPlan(state, team, extra = {}) {
  const { start } = slotWindow(SEED_WEEK, 4, 12, 6, state.guild)
  const plan = { start, team, locked: [], attendance: {}, cancelled: false, published: null, ...extra }
  return {
    ...state,
    weeks: { ...state.weeks, [SEED_WEEK]: { ...state.weeks[SEED_WEEK], plans: { 'raid-20': plan } } },
  }
}

describe('officer dashboard', () => {
  test('every raid profile is listed for this week and next, with nothing planned yet', () => {
    const weeks = officerDashboard(createSeedState(), NOW)
    expect(weeks.map((w) => w.weekIso)).toEqual([0, 7, 14, 21].map((d) => addDays(SEED_WEEK, d)))
    expect(weeks[0].raids.map((r) => r.status)).toEqual(['unplanned', 'unplanned', 'unplanned'])
    expect(weeks[1].raids).toHaveLength(3)
    expect(weeks[2].raids).toEqual([])
    expect(weeks[0].waiting).toBe(0)
    expect(weeks[2].waiting).toBeNull()
    expect(attentionCount(weeks)).toBe(6)
  })

  test('a draft reports publication, open slots and players who cannot come', () => {
    const team = [{ memberId: 'm0', characterId: 'c0a', role: 'Tank' }]
    const state = withPlan(createSeedState(), team)
    state.weeks[SEED_WEEK].checkins.m0 = { checkedIn: true, ranges: [], declined: [] }
    const raid = raidOf(officerDashboard(state, NOW), SEED_WEEK, 'raid-20')
    expect(raid.status).toBe('draft')
    expect(codes(raid)).toEqual(['unpublished', 'open-slots', 'conflicts'])
    expect(raid.issues[1].message).toBe('19 open slots')
  })

  test('tentative players and unpublished draft changes are called out separately', () => {
    const team = [{ memberId: 'm0', characterId: 'c0a', role: 'Tank' }]
    let state = withPlan(createSeedState(), team)
    const plan = state.weeks[SEED_WEEK].plans['raid-20']
    state = withPlan(state, team, { published: { start: plan.start, team: [] } })
    const window = { start: plan.start, end: plan.start + 3 * 3600000 }
    state.weeks[SEED_WEEK].checkins.m0 = {
      checkedIn: true,
      ranges: [],
      declined: [],
      tentativeRanges: [window],
    }
    expect(codes(raidOf(officerDashboard(state, NOW), SEED_WEEK, 'raid-20'))).toEqual([
      'draft-changes',
      'open-slots',
      'tentative',
    ])
  })

  test('composition rules add their warnings', () => {
    const state = withPlan(createSeedState(), [{ memberId: 'm6', characterId: 'c6a', role: 'DPS' }])
    state.settings.raids = state.settings.raids.map((raid) =>
      raid.id === 'raid-20' ? { ...raid, rules: { classLimits: { Mage: 0 } } } : raid,
    )
    expect(codes(raidOf(officerDashboard(state, NOW), SEED_WEEK, 'raid-20'))).toContain('class-limit')
  })

  test('cancelled and finished raids need nothing; scheduled dates appear in later weeks', () => {
    let state = withPlan(createSeedState(), [], { cancelled: true })
    expect(raidOf(officerDashboard(state, NOW), SEED_WEEK, 'raid-20')).toMatchObject({
      status: 'cancelled',
      issues: [],
    })
    state = withPlan(createSeedState(), [])
    const afterRaid = Date.parse('2026-10-04T12:00:00Z')
    expect(raidOf(officerDashboard(state, afterRaid), SEED_WEEK, 'raid-20')).toBeUndefined()

    state = createSeedState()
    state.settings.raids = state.settings.raids.map((raid) =>
      raid.id === 'raid-20'
        ? {
            ...raid,
            series: {
              startDate: SEED_WEEK,
              endDate: addDays(SEED_WEEK, 60),
              day: 4,
              minutes: 18 * 60,
              timezone: state.guild.timezone,
            },
          }
        : raid,
    )
    const later = officerDashboard(state, NOW)[3]
    expect(later.raids.map((r) => r.raidId)).toEqual(['raid-20'])
    expect(later.raids[0].issues[0].message).toBe('Scheduled · no draft yet')
  })
})
