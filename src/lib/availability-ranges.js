import { slotWindow } from './grid.js'
import { normalize } from './intervals.js'
import { addDays, daysBetween, wallTime, zonedTimeToUtc } from './time.js'

/** Select exact UTC boundaries instead of interpreting ambiguous local wall-clock input. */
export function dayBoundaries(weekIso, day, grid) {
  return [
    ...new Set(
      Array.from(
        { length: grid.slotsPerDay + 1 },
        (_, slot) => slotWindow(weekIso, day, slot, 0, grid).start,
      ),
    ),
  ].sort((a, b) => a - b)
}

export function rangesForDay(ranges, boundaries) {
  const start = boundaries[0]
  const end = boundaries.at(-1)
  return normalize(
    ranges.map((range) => ({ start: Math.max(start, range.start), end: Math.min(end, range.end) })),
  )
}

export function rangeFromSelection(boundaries, start, end) {
  start = Number(start)
  end = Number(end)
  return boundaries.includes(start) && boundaries.includes(end) && end > start ? { start, end } : null
}

/** Copy guild wall-clock times, including overnight ranges, without shifting them across DST. */
export function copyRangesToDay(ranges, weekIso, fromDay, toDay, grid) {
  const sourceDate = addDays(weekIso, fromDay)
  const targetDate = addDays(weekIso, toDay)
  const move = (instant) => {
    const wall = wallTime(instant, grid.timezone)
    return zonedTimeToUtc(
      targetDate,
      daysBetween(sourceDate, wall.dateIso) * 1440 + wall.minutes,
      grid.timezone,
    )
  }
  const source = rangesForDay(ranges, dayBoundaries(weekIso, fromDay, grid))
  return rangesForDay(
    source.map(({ start, end }) => ({ start: move(start), end: move(end) })),
    dayBoundaries(weekIso, toDay, grid),
  )
}
