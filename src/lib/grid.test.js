import { describe, expect, test } from 'vitest'
import {
  formatDateIn,
  formatRowLabel,
  formatSessionIn,
  formatSlotDay,
  formatTimesIn,
  rowLabelsVary,
  sessionWindows,
  slotClock,
  slotWindow,
} from './grid.js'

const WEEK = '2026-10-05'
/** Pacific guild, 8 pm to 2 am: raids run past midnight. */
const OVERNIGHT = { timezone: 'America/Los_Angeles', dayStartHour: 20, slotsPerDay: 12 }
const EVENING = { timezone: 'America/Los_Angeles', dayStartHour: 18, slotsPerDay: 12 }

describe('overnight grids', () => {
  test('slots after midnight belong to the next calendar day', () => {
    // Monday column, 1 am slot (slot 10 = 8 pm + 5 h) is Tuesday 1 am Pacific = 08:00 UTC.
    expect(slotWindow(WEEK, 0, 10, 1, OVERNIGHT).start).toBe(Date.UTC(2026, 9, 6, 8))
    expect(slotClock(WEEK, 0, 10, OVERNIGHT)).toEqual({ minutes: 60, dayShift: 1 })
    expect(formatSlotDay(WEEK, 0, 10, OVERNIGHT)).toBe('Tue 1:00 am')
    expect(formatRowLabel(WEEK, 10, OVERNIGHT)).toBe('1:00 am +1')
  })

  test('one night does not overlap the next', () => {
    const windows = sessionWindows(WEEK, 1, OVERNIGHT)
    const starts = windows.map((w) => w.start)
    expect(new Set(starts).size).toBe(starts.length)
    const mondayLast = windows.filter((w) => w.day === 0).at(-1)
    const tuesdayFirst = windows.find((w) => w.day === 1)
    expect(mondayLast.end).toBeLessThanOrEqual(tuesdayFirst.start)
  })

  test('Sunday night labels wrap to Monday', () => {
    expect(formatSlotDay(WEEK, 6, 10, OVERNIGHT)).toBe('Mon 1:00 am')
  })
})

describe('labels in another timezone', () => {
  test('row labels mark when a guild evening is the next day for the viewer', () => {
    // 6 pm Pacific is 3 am the next day in Berlin (summer time on both sides).
    expect(formatRowLabel(WEEK, 0, EVENING)).toBe('6:00 pm')
    expect(formatRowLabel(WEEK, 0, EVENING, 'Europe/Berlin')).toBe('3:00 am +1')
    expect(formatSlotDay(WEEK, 0, 0, EVENING, 'Europe/Berlin')).toBe('Tue 3:00 am')
  })

  test('sessions read in the viewer zone', () => {
    const session = slotWindow(WEEK, 0, 2, 4, EVENING) // Mon 7–9 pm Pacific
    expect(formatSessionIn(session, 'America/Los_Angeles')).toBe('Mon · 7:00 pm–9:00 pm')
    expect(formatSessionIn(session, 'America/New_York')).toBe('Mon · 10:00 pm–12:00 am')
    expect(formatTimesIn(session, 'Europe/Berlin')).toBe('4:00 am – 6:00 am')
    expect(formatDateIn(session, 'Europe/Berlin')).toBe('Tue Oct 6')
  })

  test('a viewer behind the guild sees the previous day', () => {
    const tokyo = { timezone: 'Asia/Tokyo', dayStartHour: 8, slotsPerDay: 4 }
    expect(formatRowLabel(WEEK, 0, tokyo, 'America/Los_Angeles')).toBe('4:00 pm −1')
  })
})

describe('rowLabelsVary', () => {
  test('is false in an ordinary week', () => {
    expect(rowLabelsVary(WEEK, EVENING)).toBe(false)
    expect(rowLabelsVary(WEEK, EVENING, 'Europe/Berlin')).toBe(false)
  })

  test('is true when the viewer’s clocks change mid-week', () => {
    // Europe leaves summer time on Sunday Oct 25, 2026; Pacific time changes a week later.
    expect(rowLabelsVary('2026-10-19', EVENING, 'Europe/Berlin')).toBe(true)
    expect(rowLabelsVary('2026-10-19', EVENING)).toBe(false)
  })
})
