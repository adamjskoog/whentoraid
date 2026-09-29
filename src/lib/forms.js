import { LATEST_END_HOUR } from './guild.js'
import { formatClock } from './time.js'

const CHARACTER_KEYS = ['name', 'realm', 'class', 'spec', 'role']

/** Character input from a form rendered with <CharacterFields {prefix}>. */
export function readCharacterFields(form, prefix = '') {
  return Object.fromEntries(CHARACTER_KEYS.map((key) => [key, String(form.get(`${prefix}${key}`) ?? '')]))
}

function hourLabel(hour) {
  if (hour === 24) return 'Midnight (end of day)'
  return hour > 24 ? `${formatClock(hour * 60)} (next day)` : formatClock(hour * 60)
}

const hourOptions = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ value: from + i, label: hourLabel(from + i) }))

/** Raid-hour pickers. Raids start on the day itself and may end the next morning. */
export const START_HOUR_OPTIONS = hourOptions(0, 23)
export const END_HOUR_OPTIONS = hourOptions(1, LATEST_END_HOUR)
