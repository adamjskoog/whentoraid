import { describe, expect, test } from 'vitest'
import { createSeedState, SEED_WEEK } from './seed.js'
import { getCheckin, getRawCheckin, setAvailabilityKind, setAbsenceDates } from './model.js'
import { addDays, zonedTimeToUtc } from './time.js'
import { parseState } from './storage.js'
import { rowsToState, stateToRows } from './remote/rows.js'

const windowFor = (state, day = 0) => ({
  start: zonedTimeToUtc(addDays(SEED_WEEK, day), 19 * 60, state.guild.timezone),
  end: zonedTimeToUtc(addDays(SEED_WEEK, day), 21 * 60, state.guild.timezone),
})

describe('availability preferences', () => {
  test('preferred is firm and switching to tentative removes firm coverage', () => {
    let state = createSeedState()
    const interval = windowFor(state)
    state = setAvailabilityKind(state, SEED_WEEK, 'm0', interval, 'preferred', true)
    expect(getCheckin(state, SEED_WEEK, 'm0').preferredRanges).toContainEqual(interval)
    state = setAvailabilityKind(state, SEED_WEEK, 'm0', interval, 'tentative', true)
    const checkin = getCheckin(state, SEED_WEEK, 'm0')
    expect(checkin.tentativeRanges).toContainEqual(interval)
    expect(checkin.preferredRanges).toEqual([])
    expect(checkin.ranges.some((r) => r.start <= interval.start && r.end >= interval.end)).toBe(false)
  })

  test('date-range absences mask times across weeks and can be removed without losing the schedule', () => {
    let state = createSeedState()
    const interval = windowFor(state)
    state = setAvailabilityKind(state, SEED_WEEK, 'm0', interval, 'preferred', true)
    const result = setAbsenceDates(state, 'm0', SEED_WEEK, addDays(SEED_WEEK, 8), true)
    expect(result.error).toBeUndefined()
    expect(getCheckin(result.state, SEED_WEEK, 'm0').ranges).toEqual([])
    expect(getRawCheckin(result.state, SEED_WEEK, 'm0').preferredRanges).toContainEqual(interval)
    expect(getCheckin(result.state, addDays(SEED_WEEK, 7), 'm0').checkedIn).toBe(true)
    const restored = setAbsenceDates(result.state, 'm0', SEED_WEEK, addDays(SEED_WEEK, 8), false)
    expect(getCheckin(restored.state, SEED_WEEK, 'm0').preferredRanges).toContainEqual(interval)
  })

  test('removing an away week a player never answered leaves them waiting again', () => {
    const state = createSeedState()
    const nextWeek = addDays(SEED_WEEK, 14)
    const away = setAbsenceDates(state, 'm0', nextWeek, addDays(nextWeek, 6), true).state
    expect(getCheckin(away, nextWeek, 'm0').checkedIn).toBe(true)
    const back = setAbsenceDates(away, 'm0', nextWeek, addDays(nextWeek, 6), false).state
    expect(getCheckin(back, nextWeek, 'm0').checkedIn).toBe(false)
    const kept = setAbsenceDates(state, 'm0', SEED_WEEK, SEED_WEEK, true).state
    const restored = setAbsenceDates(kept, 'm0', SEED_WEEK, SEED_WEEK, false).state
    expect(getCheckin(restored, SEED_WEEK, 'm0').checkedIn).toBe(true)
  })

  test('rejects reversed or excessive ranges and unknown players', () => {
    const state = createSeedState()
    expect(setAbsenceDates(state, 'm0', addDays(SEED_WEEK, 2), SEED_WEEK).error).toBeTruthy()
    expect(setAbsenceDates(state, 'm0', SEED_WEEK, addDays(SEED_WEEK, 367)).error).toBeTruthy()
    expect(setAbsenceDates(state, 'unknown', SEED_WEEK, SEED_WEEK).error).toBeTruthy()
  })

  test('preferences and absences survive backups and online rows', () => {
    let state = createSeedState()
    state = setAvailabilityKind(state, SEED_WEEK, 'm0', windowFor(state), 'tentative', true)
    state = setAbsenceDates(state, 'm0', SEED_WEEK, SEED_WEEK).state
    expect(parseState(JSON.stringify(state))).toEqual(state)
    const roundtrip = rowsToState(stateToRows(state, 'guild-id'), state)
    expect(getRawCheckin(roundtrip, SEED_WEEK, 'm0')).toEqual(getRawCheckin(state, SEED_WEEK, 'm0'))
    state.weeks[SEED_WEEK].checkins.m0.tentativeRanges = [{ start: 5, end: 2 }]
    expect(parseState(JSON.stringify(state))).toBeNull()
  })
})
