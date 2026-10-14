import { describe, expect, test } from 'vitest'
import { copyRangesToDay, dayBoundaries, rangeFromSelection, rangesForDay } from './availability-ranges.js'
import { wallTime } from './time.js'

const grid = { timezone: 'America/Los_Angeles', dayStartHour: 22, slotsPerDay: 8 }

describe('day range editing', () => {
  test('copying an overnight range keeps wall-clock times across a fall clock change', () => {
    const boundaries = dayBoundaries('2026-10-26', 5, grid)
    const original = [{ start: boundaries[0], end: boundaries.at(-1) }]
    const [copied] = copyRangesToDay(original, '2026-10-26', 5, 6, grid)
    expect(wallTime(copied.start, grid.timezone)).toEqual({ dateIso: '2026-11-01', minutes: 22 * 60 })
    expect(wallTime(copied.end, grid.timezone)).toEqual({ dateIso: '2026-11-02', minutes: 2 * 60 })
    expect(copied.end - copied.start).toBe(4 * 60 * 60_000)
    expect(original[0].end - original[0].start).toBe(5 * 60 * 60_000)
  })

  test('copying clips to the source day and leaves the original ranges untouched', () => {
    const boundaries = dayBoundaries('2026-10-26', 0, grid)
    const original = [{ start: boundaries[0] - 3600000, end: boundaries.at(-1) + 3600000 }]
    const snapshot = structuredClone(original)
    const copied = copyRangesToDay(original, '2026-10-26', 0, 1, grid)
    const target = dayBoundaries('2026-10-26', 1, grid)
    expect(copied).toEqual([{ start: target[0], end: target.at(-1) }])
    expect(original).toEqual(snapshot)
  })
  test('an overnight day preserves exact UTC boundaries through the fall clock change', () => {
    const boundaries = dayBoundaries('2026-10-26', 5, grid)
    const interval = rangeFromSelection(boundaries, boundaries[0], boundaries.at(-1))
    expect(wallTime(interval.start, grid.timezone)).toEqual({ dateIso: '2026-10-31', minutes: 22 * 60 })
    expect(wallTime(interval.end, grid.timezone)).toEqual({ dateIso: '2026-11-01', minutes: 2 * 60 })
    expect(interval.end - interval.start).toBe(5 * 60 * 60_000)
  })

  test('spring clock changes produce distinct ascending options and no empty intervals', () => {
    const boundaries = dayBoundaries('2026-03-02', 5, { ...grid, slotsPerDay: 12 })
    expect(boundaries).toEqual([...new Set(boundaries)].sort((a, b) => a - b))
    const interval = rangeFromSelection(boundaries, boundaries[0], boundaries.at(-1))
    expect(interval.end - interval.start).toBe(5 * 60 * 60_000)
    expect(rangeFromSelection(boundaries, boundaries[2], boundaries[1])).toBeNull()
    expect(rangeFromSelection(boundaries, boundaries[0] + 1, boundaries[1])).toBeNull()
  })

  test('a removal clips to this day and preserves spillover into another day', () => {
    const boundaries = [1000, 2000, 3000]
    expect(
      rangesForDay(
        [
          { start: 0, end: 2000 },
          { start: 2500, end: 5000 },
        ],
        boundaries,
      ),
    ).toEqual([
      { start: 1000, end: 2000 },
      { start: 2500, end: 3000 },
    ])
  })
})
