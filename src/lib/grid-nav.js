import { DAYS } from './constants.js'

/** Grid rows are time slots and columns are days, so up/down changes the slot and left/right the day. */
const MOVES = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
}

const clamp = (n, max) => Math.max(0, Math.min(n, max))

/**
 * The cell a navigation key moves to, staying inside the grid. Home and End jump to the first and
 * last slot of the day. Returns null for keys that do not navigate.
 * @param {{ day: number, slot: number }} cell
 * @returns {{ day: number, slot: number } | null}
 */
export function nextCell({ day, slot }, key, slotsPerDay) {
  if (key === 'Home') return { day, slot: 0 }
  if (key === 'End') return { day, slot: slotsPerDay - 1 }
  const move = MOVES[key]
  if (!move) return null
  return { day: clamp(day + move[0], DAYS.length - 1), slot: clamp(slot + move[1], slotsPerDay - 1) }
}

/** Focus the cell button for `cell` inside `container` (cells carry data-day and data-slot). */
export function focusCell(container, { day, slot }) {
  container?.querySelector(`[data-day="${day}"][data-slot="${slot}"]`)?.focus()
}
