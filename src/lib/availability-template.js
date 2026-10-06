import { weekSlotWindows, slotWindow } from './grid.js'
import { addInterval, covers } from './intervals.js'

/** Store wall-clock cells, not UTC offsets, so a recurring evening stays at the same local time. */
export function templateFromRanges(weekIso, ranges, guild) {
  const grid = { timezone: guild.timezone, dayStartHour: guild.dayStartHour, slotsPerDay: guild.slotsPerDay }
  const slots = weekSlotWindows(weekIso, grid).flatMap((day, d) =>
    day.flatMap((window, s) => (covers(ranges, window) ? [d * grid.slotsPerDay + s] : [])),
  )
  return { ...grid, fromWeek: weekIso, slots }
}

export function templateRanges(template, weekIso) {
  if (!template || weekIso < template.fromWeek) return null
  return template.slots.reduce((ranges, cell) => {
    const window = slotWindow(
      weekIso,
      Math.floor(cell / template.slotsPerDay),
      cell % template.slotsPerDay,
      1,
      template,
    )
    return window.end > window.start ? addInterval(ranges, window) : ranges
  }, [])
}
