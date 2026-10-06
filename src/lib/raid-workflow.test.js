import { describe, expect, test } from 'vitest'
import {
  copyPreviousRoster,
  hasDraftChanges,
  publishPlan,
  undoRosterChange,
  weeklyOverview,
  withdrawPlan,
} from './raid-workflow.js'
import { setCurrentRaid } from './raids.js'
import { createSeedState, SEED_WEEK } from './seed.js'
import {
  getCheckin,
  getWeek,
  isOffered,
  removeAvailabilityTemplate,
  saveAvailabilityTemplate,
  setPlan,
  setRaidParticipation,
} from './model.js'
import { benchMember, plannerContext } from './planning.js'
import { addDays, wallTime } from './time.js'

const TEN = 'raid-10-1'
const TWENTY = 'raid-20'

/** The seed guild with the selected raid's suggested roster saved as a draft. */
function drafted(raidId = TWENTY) {
  const state = setCurrentRaid(createSeedState(), raidId)
  const { plan } = plannerContext(state)
  return setPlan(state, SEED_WEEK, plan)
}

function publish(state) {
  const { plan, players } = plannerContext(state)
  return publishPlan(state, plan, players, 1000)
}

describe('publishing', () => {
  test('freezes a snapshot that later draft edits do not change', () => {
    const { state, error } = publish(drafted())
    expect(error).toBeUndefined()
    const published = getWeek(state, SEED_WEEK).plan.published
    expect(published.publishedAt).toBe(1000)
    expect(hasDraftChanges(state, plannerContext(state).plan)).toBe(false)

    const { plan } = plannerContext(state)
    const edited = setPlan(state, SEED_WEEK, {
      ...plan,
      team: benchMember(plan.team, published.team[0].memberId),
    })
    expect(getWeek(edited, SEED_WEEK).plan.published).toEqual(published)
    expect(hasDraftChanges(edited, plannerContext(edited).plan)).toBe(true)
  })

  test('refuses an empty roster', () => {
    const state = drafted()
    const { plan, players } = plannerContext(state)
    expect(publishPlan(state, { ...plan, team: [] }, players).error).toMatch(/Add players/)
  })

  test('refuses players already published in another raid at the same time', () => {
    const first = publish(drafted(TWENTY)).state
    const { plan } = plannerContext(first)
    const second = setPlan(setCurrentRaid(first, TEN), SEED_WEEK, {
      start: plan.start,
      team: plan.team.filter((e) => e.role === 'Tank').slice(0, 1),
    })
    expect(publish(second).error).toMatch(/overlapping players/)
  })

  test('withdrawing keeps the draft but removes the published roster', () => {
    const state = withdrawPlan(publish(drafted()).state)
    const plan = getWeek(state, SEED_WEEK).plan
    expect(plan.published).toBeNull()
    expect(plan.team.length).toBeGreaterThan(0)
  })

  test('the weekly overview lists every raid with its publication state', () => {
    const overview = weeklyOverview(publish(drafted()).state, SEED_WEEK)
    expect(overview.map((item) => item.raid.id)).toEqual([TEN, 'raid-10-2', TWENTY])
    expect(overview.find((item) => item.raid.id === TWENTY).published).toBe(true)
    expect(overview.find((item) => item.raid.id === TEN).plan).toBeNull()
  })
})

describe('undo and copy', () => {
  test('undo restores the plan as it was before the change', () => {
    const before = drafted()
    const { plan } = plannerContext(before)
    const after = setPlan(before, SEED_WEEK, { ...plan, team: benchMember(plan.team, plan.team[0].memberId) })
    const change = {
      week: SEED_WEEK,
      raidId: TWENTY,
      before: getWeek(before, SEED_WEEK).plan,
      after: getWeek(after, SEED_WEEK).plan,
    }
    expect(getWeek(undoRosterChange(after, change).state, SEED_WEEK).plan).toEqual(change.before)
  })

  test('undo refuses when the roster changed again since', () => {
    const change = { week: SEED_WEEK, raidId: TWENTY, before: null, after: { team: [] } }
    expect(undoRosterChange(drafted(), change).error).toMatch(/changed since/)
  })

  test('copies last week’s roster into the next week at the same local time', () => {
    const state = { ...drafted(), currentWeek: addDays(SEED_WEEK, 7) }
    const { state: copied, error } = copyPreviousRoster(state)
    expect(error).toBeUndefined()
    const source = getWeek(state, SEED_WEEK).plan
    const plan = getWeek(copied, state.currentWeek).plan
    expect(plan.team).toEqual(source.team)
    expect(wallTime(plan.start, state.guild.timezone).minutes).toBe(
      wallTime(source.start, state.guild.timezone).minutes,
    )
  })

  test('copying with no roster last week explains why', () => {
    expect(copyPreviousRoster(createSeedState()).error).toMatch(/no roster to copy/)
  })
})

describe('usual availability and raid preferences', () => {
  const member = 'm0'

  test('a saved schedule fills later weeks at the same local time, across daylight saving', () => {
    const state = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, member)
    const zone = state.guild.timezone
    const original = getCheckin(state, SEED_WEEK, member).ranges
    expect(original.length).toBeGreaterThan(0)
    const afterDst = getCheckin(state, '2026-11-09', member)
    expect(afterDst.checkedIn).toBe(true)
    expect(afterDst.ranges.map((r) => wallTime(r.start, zone).minutes)).toEqual(
      original.map((r) => wallTime(r.start, zone).minutes),
    )
    expect(getCheckin(state, addDays(SEED_WEEK, -7), member).checkedIn).toBe(false)
  })

  test('removing the schedule leaves saved weeks alone and empties later weeks', () => {
    const saved = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, member)
    const state = removeAvailabilityTemplate(saved, member)
    expect(getCheckin(state, SEED_WEEK, member).ranges.length).toBeGreaterThan(0)
    expect(getCheckin(state, addDays(SEED_WEEK, 7), member).checkedIn).toBe(false)
  })

  test('opting out of one raid leaves the others offered', () => {
    const state = setRaidParticipation(createSeedState(), SEED_WEEK, member, TEN, false)
    const checkin = getCheckin(state, SEED_WEEK, member)
    const characterId = state.characters.find((c) => c.memberId === member).id
    expect(isOffered(checkin, characterId, TEN)).toBe(false)
    expect(isOffered(checkin, characterId, TWENTY)).toBe(true)
  })
})
