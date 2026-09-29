import { DAYS, SLOT_MINUTES } from './constants.js'
import {
  addDays,
  daysBetween,
  formatClock,
  formatMonthDay,
  wallTime,
  weekdayIndex,
  zonedTimeToUtc,
} from './time.js'

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

/**
 * Where a slot's start falls on the wall clock in `zone` (the guild's by default): minutes after
 * midnight, and `dayShift`, how many days after its column's date. Slots after midnight in an
 * overnight grid, or shown in a viewer's timezone, can land on the next or previous day.
 */
export function slotClock(weekIso, day, slot, grid, zone = grid.timezone) {
  const { start } = slotWindow(weekIso, day, slot, 0, grid)
  const wall = wallTime(start, zone)
  return { minutes: wall.minutes, dayShift: daysBetween(addDays(weekIso, day), wall.dateIso) }
}

/** "Tue 1:00 am": a slot's start, named by the day it falls on in `zone`. */
export function formatSlotDay(weekIso, day, slot, grid, zone = grid.timezone) {
  const { minutes, dayShift } = slotClock(weekIso, day, slot, grid, zone)
  return `${DAYS[(day + dayShift + DAYS.length) % DAYS.length]} ${formatClock(minutes)}`
}

/**
 * True when a clock change (in the guild's or the viewer's zone) makes some days' rows start at a
 * different time than Monday's. Row labels are Monday's times, so the week bar says so then.
 */
export function rowLabelsVary(weekIso, grid, zone = grid.timezone) {
  const monday = slotClock(weekIso, 0, 0, grid, zone)
  return DAYS.some((_, day) => {
    const clock = slotClock(weekIso, day, 0, grid, zone)
    return clock.minutes !== monday.minutes || clock.dayShift !== monday.dayShift
  })
}

/** A grid row's time label in `zone`, marked "+1" or "−1" when it falls on another day than its column. */
export function formatRowLabel(weekIso, slot, grid, zone = grid.timezone) {
  const { minutes, dayShift } = slotClock(weekIso, 0, slot, grid, zone)
  const marker = dayShift > 0 ? ` +${dayShift}` : dayShift < 0 ? ` −${-dayShift}` : ''
  return `${formatClock(minutes)}${marker}`
}

/** "Tue · 7:00 pm–9:00 pm" for a UTC session, in `zone`. */
export function formatSessionIn({ start, end }, zone) {
  const from = wallTime(start, zone)
  return `${DAYS[weekdayIndex(from.dateIso)]} · ${formatClock(from.minutes)}–${formatClock(wallTime(end, zone).minutes)}`
}

/** "7:00 pm – 9:00 pm" for a UTC session, in `zone`. */
export function formatTimesIn({ start, end }, zone) {
  return `${formatClock(wallTime(start, zone).minutes)} – ${formatClock(wallTime(end, zone).minutes)}`
}

/** "Tue Oct 6": the day a UTC session starts, in `zone`. */
export function formatDateIn({ start }, zone) {
  const { dateIso } = wallTime(start, zone)
  return `${DAYS[weekdayIndex(dateIso)]} ${formatMonthDay(dateIso)}`
}
