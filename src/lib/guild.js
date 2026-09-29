import { DAYS, SLOT_MINUTES } from './constants.js'
import { isValidTimeZone } from './time.js'

export const GUILD_NAME_MAX = 60

/** New guilds ask for check-ins by Wednesday at 6 pm, guild time. */
export const DEFAULT_CHECKIN_DEADLINE = { day: 2, minutes: 18 * 60 }

const SLOTS_PER_HOUR = 60 / SLOT_MINUTES
const MINUTES_PER_DAY = 24 * 60

/** Fallback when the browser cannot list its timezones. */
const COMMON_TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
]

/**
 * Raids may run past midnight: the latest end is 6 am the next day, written as hour 30. Each night's
 * planning window still spans at most a day, so one night's grid never overlaps the next.
 */
export const LATEST_END_HOUR = 30
const HOURS_PER_DAY = 24

/** The guild's planning hours as whole hours; `endHour` 24 means midnight, above 24 the next morning. */
export function raidHours(guild) {
  return { startHour: guild.dayStartHour, endHour: guild.dayStartHour + guild.slotsPerDay / SLOTS_PER_HOUR }
}

/** Grid fields for planning hours already checked by `validateGuild`. */
export function gridFromHours(startHour, endHour) {
  return { dayStartHour: startHour, slotsPerDay: (endHour - startHour) * SLOTS_PER_HOUR }
}

/**
 * @param {{ name: string, timezone: string, startHour: number, endHour: number }} input
 * @param {number} durationSlots the raid length, which must fit inside the planning hours
 * @returns {string | null} an error message, or null when valid
 */
export function validateGuild({ name, timezone, startHour, endHour }, durationSlots) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return 'Guild name is required.'
  if (trimmed.length > GUILD_NAME_MAX) return `Guild name must be ${GUILD_NAME_MAX} characters or fewer.`
  if (!isValidTimeZone(timezone)) return 'Choose a valid timezone.'

  const wholeHours = Number.isInteger(startHour) && Number.isInteger(endHour)
  const validRange =
    startHour >= 0 &&
    startHour < HOURS_PER_DAY &&
    endHour > startHour &&
    endHour <= LATEST_END_HOUR &&
    endHour - startHour <= HOURS_PER_DAY
  if (!wholeHours || !validRange) {
    return 'Raid hours must start before they end, end by 6 am, and span at most 24 hours.'
  }
  if ((endHour - startHour) * SLOTS_PER_HOUR < durationSlots) {
    return `Raid hours must be at least as long as the raid (${durationSlots / SLOTS_PER_HOUR} hours).`
  }
  return null
}

/** @returns {string | null} an error message, or null when valid. A null deadline means "none". */
export function validateDeadline(deadline) {
  if (deadline === null) return null
  const { day, minutes } = deadline ?? {}
  const validDay = Number.isInteger(day) && day >= 0 && day < DAYS.length
  const validTime = Number.isInteger(minutes) && minutes >= 0 && minutes < MINUTES_PER_DAY
  return validDay && validTime ? null : 'Choose a valid check-in deadline.'
}

/** Timezones to offer in a picker, always including the current one. */
export function timeZoneOptions(current) {
  const all =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : COMMON_TIMEZONES
  return !current || all.includes(current) ? all : [current, ...all]
}

/** "HH:MM" for an <input type="time">. */
export function minutesToTimeInput(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Minutes after midnight from an <input type="time"> value, or NaN when blank or malformed. */
export function timeInputToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ''))
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN
}
