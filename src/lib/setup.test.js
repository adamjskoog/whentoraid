import { describe, expect, test } from 'vitest'
import {
  gridFromHours,
  minutesToTimeInput,
  raidHours,
  timeInputToMinutes,
  timeZoneOptions,
  validateDeadline,
  validateGuild,
} from './guild.js'
import { saveSettings, setPlan, getWeek } from './model.js'
import { applySettings, plannerContext } from './planning.js'
import { createSeedState, SEED_WEEK } from './seed.js'
import { createGuildState } from './setup.js'

describe('applySettings with new raid hours', () => {
  test('the chosen session keeps its clock time when the day start moves', () => {
    const before = plannerContext(createSeedState()).plan
    const { state, error } = applySettings(createSeedState(), {
      targets: [2, 4, 14],
      durationSlots: 6,
      startHour: 16,
      endHour: 24,
    })
    expect(error).toBeUndefined()
    const after = getWeek(state, SEED_WEEK).plan
    expect(after.start).toBe(before.start)
  })

  const BASE = { targets: [2, 4, 14], durationSlots: 6 }

  /** The seed week with its suggested roster saved and one attendance mark. */
  function recorded() {
    const seed = createSeedState()
    const { plan } = plannerContext(seed)
    return {
      plan,
      state: setPlan(seed, SEED_WEEK, { start: plan.start, team: plan.team, attendance: { m0: 'late' } }),
    }
  }

  test('saving settings that do not change the raid keeps the roster and attendance', () => {
    const { state } = recorded()
    const next = applySettings(state, { ...BASE, guildName: 'Renamed', checkinDeadline: null }).state
    expect(getWeek(next, SEED_WEEK).plan).toEqual(getWeek(state, SEED_WEEK).plan)
  })

  test('a timezone change moves saved plans in every week to the same clock time', () => {
    const { plan, state: seeded } = recorded()
    const lastWeek = '2026-09-21'
    const pastStart = plan.start - 7 * 24 * 3600_000
    const state = setPlan(seeded, lastWeek, {
      start: pastStart,
      team: plan.team,
      attendance: { m1: 'attended' },
    })
    // New York is 3 hours ahead of Los Angeles, so the same wall-clock time is 3 hours earlier in UTC.
    const next = applySettings(state, { ...BASE, timezone: 'America/New_York' }).state
    const THREE_HOURS = 3 * 3600_000
    expect(getWeek(next, SEED_WEEK).plan.start).toBe(plan.start - THREE_HOURS)
    expect(getWeek(next, SEED_WEEK).plan.attendance).toEqual({ m0: 'late' })
    expect(getWeek(next, lastWeek).plan.start).toBe(pastStart - THREE_HOURS)
    expect(getWeek(next, lastWeek).plan.attendance).toEqual({ m1: 'attended' })
    expect(plannerContext(next).plan.saved).toBe(true)
  })
})

describe('attendance belongs to one session time', () => {
  test('moving the raid clears attendance and the cancelled flag', () => {
    const team = [{ memberId: 'm1', characterId: 'c1a', role: 'Tank' }]
    let state = setPlan(createSeedState(), SEED_WEEK, {
      start: 0,
      team,
      attendance: { m1: 'noshow' },
      cancelled: true,
    })
    state = setPlan(state, SEED_WEEK, { start: 1800_000, team })
    expect(getWeek(state, SEED_WEEK).plan.attendance).toEqual({})
    expect(getWeek(state, SEED_WEEK).plan.cancelled).toBe(false)
  })
})

const CHARACTER = { name: 'Firstlight', realm: 'Whitemane', class: 'Priest', spec: 'Holy', role: 'Healer' }
const SETUP = {
  guildName: '  Night Shift ',
  timezone: 'America/New_York',
  startHour: 18,
  endHour: 24,
  memberName: 'Sam',
  discordId: '',
  character: CHARACTER,
}

describe('validateGuild', () => {
  const valid = { name: 'Night Shift', timezone: 'Europe/London', startHour: 17, endHour: 23 }

  test('accepts a named guild with hours that fit the raid', () => {
    expect(validateGuild(valid, 6)).toBeNull()
    expect(validateGuild({ ...valid, startHour: 0, endHour: 24 }, 8)).toBeNull()
    expect(validateGuild({ ...valid, startHour: 20, endHour: 26 }, 6)).toBeNull()
  })

  test('rejects bad names, timezones, and hours', () => {
    expect(validateGuild({ ...valid, name: ' ' }, 6)).toMatch(/required/)
    expect(validateGuild({ ...valid, name: 'x'.repeat(61) }, 6)).toMatch(/60 characters/)
    expect(validateGuild({ ...valid, timezone: 'Mars/Olympus' }, 6)).toMatch(/timezone/)
    expect(validateGuild({ ...valid, startHour: 20, endHour: 18 }, 6)).toMatch(/start before/)
    expect(validateGuild({ ...valid, endHour: 31 }, 6)).toMatch(/end by 6 am/)
    expect(validateGuild({ ...valid, startHour: 2, endHour: 27 }, 6)).toMatch(/at most 24 hours/)
    expect(validateGuild({ ...valid, startHour: 17.5 }, 6)).toMatch(/start before/)
    expect(validateGuild({ ...valid, startHour: 21, endHour: 23 }, 6)).toMatch(
      /at least as long as the raid \(3 hours\)/,
    )
  })
})

describe('raid hours and deadlines', () => {
  test('hours convert to and from the half-hour grid', () => {
    expect(gridFromHours(18, 24)).toEqual({ dayStartHour: 18, slotsPerDay: 12 })
    expect(raidHours({ dayStartHour: 12, slotsPerDay: 24 })).toEqual({ startHour: 12, endHour: 24 })
  })

  test('deadlines need a weekday and a time of day; null means none', () => {
    expect(validateDeadline(null)).toBeNull()
    expect(validateDeadline({ day: 6, minutes: 1439 })).toBeNull()
    expect(validateDeadline({ day: 7, minutes: 0 })).toMatch(/deadline/)
    expect(validateDeadline({ day: 2, minutes: 1440 })).toMatch(/deadline/)
    expect(validateDeadline({ day: 2, minutes: Number.NaN })).toMatch(/deadline/)
  })

  test('time inputs round-trip', () => {
    expect(minutesToTimeInput(18 * 60 + 5)).toBe('18:05')
    expect(timeInputToMinutes('18:05')).toBe(18 * 60 + 5)
    expect(timeInputToMinutes('')).toBeNaN()
  })

  test('timezone options always include the current zone', () => {
    expect(timeZoneOptions('Europe/London')).toContain('Europe/London')
    expect(timeZoneOptions('Etc/GMT+5')[0]).toBe('Etc/GMT+5')
  })
})

describe('createGuildState', () => {
  test('creates a guild whose only member is the person setting it up', () => {
    let n = 0
    const now = Date.UTC(2026, 9, 1, 12) // Thursday, Oct 1
    const result = createGuildState(SETUP, { now, makeId: () => `id${n++}` })
    expect(result.error).toBeUndefined()
    const { state } = result
    expect(state.version).toBe(5)
    expect(state.currentWeek).toBe('2026-09-28')
    expect(state.guild).toMatchObject({
      name: 'Night Shift',
      timezone: 'America/New_York',
      dayStartHour: 18,
      slotsPerDay: 12,
    })
    expect(state.members).toEqual([{ id: 'id0', name: 'Sam', discordId: '' }])
    expect(state.currentMemberId).toBe('id0')
    expect(state.characters).toEqual([{ id: 'id1', memberId: 'id0', main: true, ...CHARACTER }])
    expect(state.weeks).toEqual({})
  })

  test('reports the first problem', () => {
    expect(createGuildState({ ...SETUP, guildName: '' }).error).toMatch(/Guild name/)
    expect(createGuildState({ ...SETUP, memberName: '' }).error).toMatch(/Player name/)
    expect(createGuildState({ ...SETUP, character: { ...CHARACTER, spec: '' } }).error).toMatch(
      /Specialization/,
    )
  })
})

describe('saveSettings with guild details', () => {
  const base = { targets: [2, 4, 14], durationSlots: 6 }

  test('renames the guild and changes timezone, hours, and deadline', () => {
    const { state, error } = saveSettings(createSeedState(), {
      ...base,
      guildName: 'Late Crew',
      timezone: 'Europe/Berlin',
      startHour: 16,
      endHour: 23,
      checkinDeadline: { day: 3, minutes: 20 * 60 },
    })
    expect(error).toBeUndefined()
    expect(state.guild).toMatchObject({
      name: 'Late Crew',
      timezone: 'Europe/Berlin',
      dayStartHour: 16,
      slotsPerDay: 14,
    })
    expect(state.settings.checkinDeadline).toEqual({ day: 3, minutes: 1200 })
  })

  test('the deadline can be turned off', () => {
    const { state } = saveSettings(createSeedState(), { ...base, checkinDeadline: null })
    expect(state.settings.checkinDeadline).toBeNull()
  })

  test('leaving guild fields out keeps them', () => {
    const initial = createSeedState()
    const { state } = saveSettings(initial, base)
    expect(state.guild).toEqual(initial.guild)
    expect(state.settings.checkinDeadline).toEqual(initial.settings.checkinDeadline)
  })

  test('raid hours shorter than the raid are rejected', () => {
    const { error } = saveSettings(createSeedState(), {
      ...base,
      durationSlots: 8,
      startHour: 20,
      endHour: 23,
    })
    expect(error).toMatch(/at least as long/)
  })
})

describe('setPlan and attendance', () => {
  const team = [
    { memberId: 'm1', characterId: 'c1a', role: 'Tank' },
    { memberId: 'm2', characterId: 'c2a', role: 'Healer' },
  ]

  test('roster edits keep recorded attendance for members still on the team', () => {
    let state = setPlan(createSeedState(), SEED_WEEK, {
      start: 0,
      team,
      attendance: { m1: 'attended', m2: 'noshow' },
      cancelled: false,
    })
    state = setPlan(state, SEED_WEEK, { start: 0, team: [team[0]] })
    expect(getWeek(state, SEED_WEEK).plan.attendance).toEqual({ m1: 'attended' })
  })

  test('the cancelled flag carries over until changed', () => {
    let state = setPlan(createSeedState(), SEED_WEEK, { start: 0, team, cancelled: true })
    state = setPlan(state, SEED_WEEK, { start: 0, team })
    expect(getWeek(state, SEED_WEEK).plan.cancelled).toBe(true)
  })
})
