import { DAYS, SLOT_MINUTES } from './constants.js'
import { addDays, formatClock, zonedTimeToUtc } from './time.js'

/**
 * The guild's weekly planning grid: half-hour slots in the guild timezone.
 * @typedef {{ timezone: string, dayStartHour: number, slotsPerDay: number }} GridConfig
 * @typedef {{ day: number, startSlot: number, start: number, end: number }} SessionWindow
 */

function slotMinutes(slot, grid) {
  return grid.dayStartHour * 60 + slot * SLOT_MINUTES
}

/** UTC interval covering `slotCount` slots from `startSlot` on day `day` of the week. */
export function slotWindow(weekIso, day, startSlot, slotCount, grid) {
  const date = addDays(weekIso, day)
  return {
    start: zonedTimeToUtc(date, slotMinutes(startSlot, grid), grid.timezone),
    end: zonedTimeToUtc(date, slotMinutes(startSlot + slotCount, grid), grid.timezone),
  }
}

/** Every one-slot interval of the week, indexed as [day][slot]. */
export function weekSlotWindows(weekIso, grid) {
  return DAYS.map((_, day) =>
    Array.from({ length: grid.slotsPerDay }, (_, slot) => slotWindow(weekIso, day, slot, 1, grid)),
  )
}

/** Every session start for the week. Sessions never run past the end of the grid day. */
export function sessionWindows(weekIso, durationSlots, grid) {
  return DAYS.flatMap((_, day) =>
    Array.from({ length: grid.slotsPerDay - durationSlots + 1 }, (_, startSlot) => ({
      day,
      startSlot,
      ...slotWindow(weekIso, day, startSlot, durationSlots, grid),
    })),
  )
}

export function clampStartSlot(slot, durationSlots, grid) {
  return Math.max(0, Math.min(slot, grid.slotsPerDay - durationSlots))
}

export function formatSlot(slot, grid) {
  return formatClock(slotMinutes(slot, grid))
}

export function formatSession(day, startSlot, durationSlots, grid) {
  return `${DAYS[day]} · ${formatSlot(startSlot, grid)}–${formatSlot(startSlot + durationSlots, grid)}`
}
