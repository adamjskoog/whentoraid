import { describe, expect, test } from 'vitest'
import { clampStartSlot, formatSession, sessionWindows, slotWindow } from './grid.js'
import { addDays, formatClock, isIsoDate, mondayOf, zonedTimeToUtc } from './time.js'

const LA = 'America/Los_Angeles'
const GRID = { timezone: LA, dayStartHour: 12, slotsPerDay: 24 }

describe('zonedTimeToUtc', () => {
  test('converts daylight time (UTC-7)', () => {
    expect(zonedTimeToUtc('2026-09-28', 18 * 60, LA)).toBe(Date.UTC(2026, 8, 29, 1, 0))
  })

  test('converts standard time after DST ends (UTC-8)', () => {
    expect(zonedTimeToUtc('2026-11-02', 18 * 60, LA)).toBe(Date.UTC(2026, 10, 3, 2, 0))
  })

  test('handles end-of-day midnight', () => {
    expect(zonedTimeToUtc('2026-09-28', 24 * 60, LA)).toBe(Date.UTC(2026, 8, 29, 7, 0))
  })
})

describe('dates', () => {
  test('mondayOf snaps any day to its week start', () => {
    expect(mondayOf('2026-09-28')).toBe('2026-09-28')
    expect(mondayOf('2026-10-01')).toBe('2026-09-28')
    expect(mondayOf('2026-10-04')).toBe('2026-09-28')
  })

  test('addDays crosses month boundaries', () => {
    expect(addDays('2026-09-28', 6)).toBe('2026-10-04')
  })

  test('isIsoDate rejects impossible dates', () => {
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-9-28')).toBe(false)
    expect(isIsoDate('2026-09-28')).toBe(true)
  })

  test('formatClock labels half hours and midnight', () => {
    expect(formatClock(12 * 60)).toBe('12:00 pm')
    expect(formatClock(18 * 60 + 30)).toBe('6:30 pm')
    expect(formatClock(24 * 60)).toBe('12:00 am')
  })
})

describe('guild grid', () => {
  test('slots stay on local noon across the DST change', () => {
    // Week of Oct 26, 2026; DST ends Sunday Nov 1.
    expect(slotWindow('2026-10-26', 0, 0, 1, GRID).start).toBe(Date.UTC(2026, 9, 26, 19, 0))
    expect(slotWindow('2026-10-26', 6, 0, 1, GRID).start).toBe(Date.UTC(2026, 10, 1, 20, 0))
  })

  test('sessions can end at midnight but never cross into the next day', () => {
    const windows = sessionWindows('2026-09-28', 6, GRID)
    expect(windows).toHaveLength(7 * (24 - 6 + 1))
    const lastMonday = windows.filter((w) => w.day === 0).at(-1)
    expect(lastMonday.startSlot).toBe(18)
    expect(lastMonday.end).toBe(zonedTimeToUtc('2026-09-28', 24 * 60, LA))
  })

  test('clampStartSlot keeps a session inside the day', () => {
    expect(clampStartSlot(22, 6, GRID)).toBe(18)
    expect(clampStartSlot(3, 6, GRID)).toBe(3)
  })

  test('formatSession describes the window', () => {
    expect(formatSession(4, 13, 6, GRID)).toBe('Fri · 6:30 pm–9:30 pm')
  })
})
