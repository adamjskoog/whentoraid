import { describe, expect, test } from 'vitest'
import { templateFor } from './availability-template.js'
import { changesClosedWeek, checkinsClosed } from './checkins.js'
import { getCheckin, markUnavailable, removeAvailabilityTemplate, saveAvailabilityTemplate } from './model.js'
import { createSeedState, SEED_WEEK } from './seed.js'
import { addDays } from './time.js'

const member = 'm0'
// The seed has no check-ins for the week after SEED_WEEK. Its deadline is Wednesday Oct 7, 6 pm in
// Los Angeles: Oct 8, 01:00 UTC.
const WEEK = addDays(SEED_WEEK, 7)
const BEFORE_DEADLINE = Date.UTC(2026, 9, 8, 0, 0)
const AFTER_DEADLINE = Date.UTC(2026, 9, 8, 2, 0)

describe('closed check-in weeks', () => {
  test('a week closes at its deadline, and never without one', () => {
    const state = createSeedState()
    expect(checkinsClosed(state, WEEK, BEFORE_DEADLINE)).toBe(false)
    expect(checkinsClosed(state, WEEK, AFTER_DEADLINE)).toBe(true)
    const none = { ...state, settings: { ...state.settings, checkinDeadline: null } }
    expect(checkinsClosed(none, WEEK, AFTER_DEADLINE)).toBe(false)
  })

  test('a new schedule from next week keeps the closed week on the schedule it replaced', () => {
    const before = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, member, AFTER_DEADLINE)
    const after = saveAvailabilityTemplate(
      markUnavailable(before, addDays(WEEK, 7), member),
      addDays(WEEK, 7),
      member,
      AFTER_DEADLINE,
    )
    expect(after.templates[member].previous).toEqual(templateFor(before.templates[member], WEEK))
    expect(getCheckin(after, WEEK, member)).toEqual(getCheckin(before, WEEK, member))
    expect(getCheckin(after, addDays(WEEK, 14), member).ranges).toEqual([])
    expect(changesClosedWeek(before, after, member, AFTER_DEADLINE)).toBe(false)
  })

  test('a second future schedule still keeps the one covering this week', () => {
    const base = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, member, AFTER_DEADLINE)
    const next = addDays(WEEK, 7)
    const first = saveAvailabilityTemplate(markUnavailable(base, next, member), next, member, AFTER_DEADLINE)
    const later = addDays(WEEK, 14)
    const second = saveAvailabilityTemplate(first, later, member, AFTER_DEADLINE)
    expect(getCheckin(second, WEEK, member)).toEqual(getCheckin(base, WEEK, member))
    expect(changesClosedWeek(first, second, member, AFTER_DEADLINE)).toBe(false)
  })

  test('without a schedule covering this week, the next future schedule is kept for the weeks before', () => {
    const state = createSeedState()
    const next = addDays(WEEK, 7)
    const first = saveAvailabilityTemplate(state, next, member, AFTER_DEADLINE)
    const second = saveAvailabilityTemplate(
      markUnavailable(first, addDays(WEEK, 14), member),
      addDays(WEEK, 14),
      member,
      AFTER_DEADLINE,
    )
    expect(getCheckin(second, next, member)).toEqual(getCheckin(first, next, member))
  })

  test('removing a schedule that fills the closed week changes it; before the deadline it does not count', () => {
    const before = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, member, AFTER_DEADLINE)
    const after = removeAvailabilityTemplate(before, member)
    expect(changesClosedWeek(before, after, member, AFTER_DEADLINE)).toBe(true)
    expect(changesClosedWeek(before, after, member, BEFORE_DEADLINE)).toBe(false)
  })

  test('a saved check-in for the closed week makes schedule changes harmless', () => {
    const saved = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, member, AFTER_DEADLINE)
    const before = markUnavailable(saved, WEEK, member)
    const after = removeAvailabilityTemplate(before, member)
    expect(changesClosedWeek(before, after, member, AFTER_DEADLINE)).toBe(false)
  })

  test('the schedule a template replaced covers only the weeks before it', () => {
    const current = { fromWeek: '2026-10-12', slots: [1] }
    const previous = { fromWeek: '2026-09-28', slots: [2] }
    const template = { ...current, previous }
    expect(templateFor(template, '2026-10-19')).toEqual(current)
    expect(templateFor(template, '2026-10-05')).toEqual(previous)
    expect(templateFor(template, '2026-09-21')).toBeNull()
  })
})
