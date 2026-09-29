import { formatClock } from './time.js'

const CHARACTER_KEYS = ['name', 'realm', 'class', 'spec', 'role']

/** Character input from a form rendered with <CharacterFields {prefix}>. */
export function readCharacterFields(form, prefix = '') {
  return Object.fromEntries(CHARACTER_KEYS.map((key) => [key, String(form.get(`${prefix}${key}`) ?? '')]))
}

/** Whole hours for raid-hour pickers; 24 is midnight at the end of the day. */
export const HOUR_OPTIONS = Array.from({ length: 25 }, (_, hour) => ({
  value: hour,
  label: hour === 24 ? 'Midnight (end of day)' : formatClock(hour * 60),
}))
