import { slotWindow } from './grid.js'
import { normalize } from './intervals.js'

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
