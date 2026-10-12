import { describe, expect, test } from 'vitest'
import { personalRaids, availabilitySource, exactSessionLabel, onboardingSteps } from './personal-raids.js'
import { createSeedState, SEED_WEEK } from './seed.js'
import { markUnavailable, saveAvailabilityTemplate, setCurrentWeek } from './model.js'

function withPlans() {
  const state = createSeedState()
  const make = (start, memberId = 'm0', characterId = 'c0a') => ({
    start,
    team: [],
    published: { start, end: start + 1000, team: [{ memberId, characterId, role: 'Tank' }] },
  })
  state.weeks[SEED_WEEK].plans = {
    'raid-10-1': make(3000),
    'raid-10-2': make(2000, 'm1', 'c1a'),
    'raid-20': make(1000),
  }
  return state
}

describe('personal raid dashboard', () => {
  test('uses published times and assignments and sorts across every raid', () => {
    const state = withPlans()
    state.weeks[SEED_WEEK].plans['raid-20'].start = 9000
    const raids = personalRaids(state, 'm0', 0)
    expect(raids.map((raid) => raid.session.start)).toEqual([1000, 2000, 3000])
    expect(raids.map((raid) => raid.character?.name)).toEqual(['Stoneguard', undefined, 'Stoneguard'])
    expect(raids[1].assignment).toBeNull()
  })

  test('excludes cancelled, withdrawn, draft and ended sessions', () => {
    const state = withPlans()
    state.weeks[SEED_WEEK].plans['raid-10-1'].cancelled = true
    state.weeks[SEED_WEEK].plans['raid-10-2'].published = null
    expect(personalRaids(state, 'm0', 2000)).toEqual([])
  })

  test('distinguishes a usual schedule from a fresh weekly response', () => {
    const state = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, 'm0', 0)
    const next = setCurrentWeek(state, '2026-10-05')
    expect(availabilitySource(next, next.currentWeek, 'm0')).toBe('Using usual schedule')
    expect(availabilitySource(next, next.currentWeek, 'm1')).toBe('No response yet')
    expect(availabilitySource(markUnavailable(next, next.currentWeek, 'm0'), next.currentWeek, 'm0')).toBe(
      'Updated this week',
    )
  })

  test('onboarding requires an active character and accepts an unavailable response', () => {
    let state = setCurrentWeek(createSeedState(), '2026-10-05')
    state.characters = state.characters.map((c) => (c.memberId === 'm0' ? { ...c, retired: true } : c))
    expect(onboardingSteps(state, 'm0').map((step) => step.complete)).toEqual([true, false, false])
    state = markUnavailable(state, state.currentWeek, 'm0')
    expect(onboardingSteps(state, 'm0').map((step) => step.complete)).toEqual([true, false, true])
  })

  test('exact labels include both dates when a local session crosses midnight', () => {
    const label = exactSessionLabel(
      { start: Date.parse('2026-10-05T23:30Z'), end: Date.parse('2026-10-06T01:00Z') },
      'UTC',
    )
    expect(label).toMatch(/Mon, Oct 5, 2026/)
    expect(label).toMatch(/Tue, Oct 6, 2026/)
    expect(label).toMatch(/UTC/)
  })
})
