import { SLOT_MINUTES } from './constants.js'
import { own } from './ids.js'
import {
  addDays,
  daysBetween,
  isIsoDate,
  isValidTimeZone,
  mondayOf,
  wallTime,
  zonedTimeToUtc,
} from './time.js'

/**
 * A raid profile's weekly schedule. Times are guild-local clock times, so a series stays at 7 pm
 * across clock changes. `minutes` counts from midnight of the planning day and may pass midnight
 * (1500 is 1 am the next morning), so overnight raids keep the planning week they belong to.
 * @typedef {{ day: number, minutes: number }} SeriesTime
 * @typedef {SeriesTime & { fromWeek: string }} SeriesChange  A new time from that week on.
 * @typedef {{ cancelled?: boolean, day?: number, minutes?: number }} SeriesException  One week only.
 * @typedef {SeriesTime & {
 *   startDate: string, endDate: string, timezone: string,
 *   changes?: SeriesChange[], exceptions?: Record<string, SeriesException>,
 * }} RaidSeries
 * @typedef {{ weekIso: string, dateIso: string, start: number | null, cancelled: boolean, error?: string }} Occurrence
 */

/** A series covers at most a year, so generating drafts stays bounded. */
export const MAX_SERIES_DAYS = 366
const MAX_MINUTES = 2 * 24 * 60
const MAX_CHANGES = 52

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isMonday = (dateIso) => isIsoDate(dateIso) && mondayOf(dateIso) === dateIso

function timeError({ day, minutes }) {
  if (!Number.isInteger(day) || day < 0 || day > 6) return 'Choose a day of the week.'
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MAX_MINUTES || minutes % SLOT_MINUTES)
    return 'Choose a start time on the half hour.'
  return null
}

function exceptionError(weekIso, exception) {
  if (!isMonday(weekIso) || !isObject(exception)) return 'Each exception must belong to a week.'
  if (exception.cancelled !== undefined && typeof exception.cancelled !== 'boolean')
    return 'Each exception must belong to a week.'
  if (exception.day === undefined && exception.minutes === undefined) return null
  return exception.day === undefined || exception.minutes === undefined
    ? 'A moved raid needs both a day and a time.'
    : timeError(exception)
}

/** @returns {string | null} why the series is unusable, or null */
export function validateRaidSeries(series) {
  if (!isObject(series)) return 'The schedule is malformed.'
  const { startDate, endDate, timezone, changes = [], exceptions = {} } = series
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return 'Choose valid first and last dates.'
  const span = daysBetween(startDate, endDate)
  if (span < 0) return 'The last date must be on or after the first date.'
  if (span >= MAX_SERIES_DAYS) return 'A schedule can cover at most one year.'
  if (!isValidTimeZone(timezone)) return 'Choose a valid timezone.'
  const error = timeError(series)
  if (error) return error
  if (!Array.isArray(changes) || changes.length > MAX_CHANGES) return 'The schedule has too many changes.'
  const changeWeeks = new Set()
  for (const change of changes) {
    if (!isObject(change) || !isMonday(change.fromWeek)) return 'Each schedule change must start on a week.'
    if (changeWeeks.has(change.fromWeek)) return 'Two schedule changes start the same week.'
    changeWeeks.add(change.fromWeek)
    const changeError = timeError(change)
    if (changeError) return changeError
  }
  if (!isObject(exceptions) || Object.keys(exceptions).length > MAX_CHANGES)
    return 'The schedule has too many exceptions.'
  for (const [weekIso, exception] of Object.entries(exceptions)) {
    const exceptionProblem = exceptionError(weekIso, exception)
    if (exceptionProblem) return exceptionProblem
  }
  return null
}

/** The day and time the series uses in `weekIso`, after changes and that week's exception. */
function timeFor(series, weekIso) {
  const change = (series.changes ?? [])
    .filter((c) => c.fromWeek <= weekIso)
    .sort((a, b) => a.fromWeek.localeCompare(b.fromWeek))
    .at(-1)
  const base = change ?? series
  const exception = own(series.exceptions, weekIso) ?? {}
  return {
    day: exception.day ?? base.day,
    minutes: exception.minutes ?? base.minutes,
    cancelled: exception.cancelled === true,
  }
}

/**
 * One occurrence per week whose planning day falls between the start and end dates, inclusive.
 * A time skipped by a clock change has no start and an error, rather than silently moving.
 * @returns {Occurrence[]}
 */
export function seriesOccurrences(series) {
  const occurrences = []
  for (let weekIso = mondayOf(series.startDate); weekIso <= series.endDate; weekIso = addDays(weekIso, 7)) {
    const { day, minutes, cancelled } = timeFor(series, weekIso)
    const planningDate = addDays(weekIso, day)
    if (planningDate < series.startDate || planningDate > series.endDate) continue
    const dateIso = addDays(planningDate, Math.floor(minutes / 1440))
    const start = zonedTimeToUtc(planningDate, minutes, series.timezone)
    const actual = wallTime(start, series.timezone)
    const exists = actual.dateIso === dateIso && actual.minutes === minutes % 1440
    occurrences.push(
      exists
        ? { weekIso, dateIso, start, cancelled }
        : {
            weekIso,
            dateIso,
            start: null,
            cancelled,
            error: `This start time does not exist on ${dateIso} because of the clock change.`,
          },
    )
  }
  return occurrences
}

/** Every day and time the series uses must fit the guild's planning hours with the raid's length. */
function hoursError(state, raid, series) {
  const { dayStartHour, slotsPerDay, timezone } = state.guild
  if (series.timezone !== timezone) return 'The schedule must use the guild timezone.'
  const times = [
    series,
    ...(series.changes ?? []),
    ...Object.values(series.exceptions ?? {}).filter((e) => e.minutes !== undefined),
  ]
  const fits = ({ minutes }) => {
    const offset = minutes - dayStartHour * 60
    return offset >= 0 && offset / SLOT_MINUTES + raid.durationSlots <= slotsPerDay
  }
  return times.every(fits) ? null : 'The raid must start and end within the guild planning hours.'
}

function withSeries(state, raidId, series) {
  const raids = state.settings.raids.map((raid) => (raid.id === raidId ? { ...raid, series } : raid))
  return { ...state, settings: { ...state.settings, raids } }
}

/**
 * Save (or with `null`, remove) a raid profile's weekly schedule. Saving never creates, publishes or
 * announces raids; `generateSeriesDrafts` creates drafts on request.
 * @returns {{ state: import('./model.js').AppState, error?: string }}
 */
export function saveRaidSeries(state, raidId, series) {
  const raid = state.settings.raids.find((r) => r.id === raidId)
  if (!raid) return { state, error: 'Raid not found.' }
  if (series === null) {
    const { series: _removed, ...rest } = raid
    const raids = state.settings.raids.map((r) => (r.id === raidId ? rest : r))
    return { state: { ...state, settings: { ...state.settings, raids } } }
  }
  const error = validateRaidSeries(series) ?? hoursError(state, raid, series)
  if (error) return { state, error }
  return { state: withSeries(state, raidId, structuredClone(series)) }
}

function setRaidPlan(state, weekIso, raidId, plan) {
  const week = state.weeks[weekIso] ?? { checkins: {}, plans: {} }
  return {
    ...state,
    weeks: { ...state.weeks, [weekIso]: { ...week, plans: { ...week.plans, [raidId]: plan } } },
  }
}

/**
 * Create empty drafts for upcoming occurrences that have no plan yet. Existing plans and every
 * check-in are left exactly as they are; nothing is published or sent.
 * @returns {{ state: import('./model.js').AppState, created: number, error?: string }}
 */
export function generateSeriesDrafts(state, raidId, { now = Date.now() } = {}) {
  const series = state.settings.raids.find((r) => r.id === raidId)?.series
  if (!series) return { state, created: 0, error: 'This raid has no weekly schedule.' }
  let next = state
  let created = 0
  for (const occurrence of seriesOccurrences(series)) {
    if (occurrence.start === null || occurrence.start <= now) continue
    if (own(next.weeks[occurrence.weekIso]?.plans, raidId)) continue
    next = setRaidPlan(next, occurrence.weekIso, raidId, {
      start: occurrence.start,
      team: [],
      locked: [],
      attendance: {},
      cancelled: occurrence.cancelled,
      published: null,
    })
    created += 1
  }
  return { state: next, created }
}

/** Apply the series to a saved, unpublished, upcoming plan; published rosters are left for officers. */
function applyToPlan(state, raidId, occurrence, now) {
  const plan = own(state.weeks[occurrence.weekIso]?.plans, raidId)
  if (!plan || occurrence.start === null || occurrence.start <= now) return { state, skipped: false }
  if (plan.published) return { state, skipped: true }
  const moved = plan.start !== occurrence.start
  const updated = {
    ...plan,
    start: occurrence.start,
    cancelled: occurrence.cancelled,
    ...(moved ? { attendance: {} } : {}),
  }
  return { state: setRaidPlan(state, occurrence.weekIso, raidId, updated), skipped: false }
}

function changedSeries(series, weekIso, change, scope) {
  if (scope === 'this') {
    const exception = { ...(own(series.exceptions, weekIso) ?? {}), ...change }
    return { ...series, exceptions: { ...series.exceptions, [weekIso]: exception } }
  }
  const current = timeFor(series, weekIso)
  const time = { day: change.day ?? current.day, minutes: change.minutes ?? current.minutes }
  const earlier = (series.changes ?? []).filter((c) => c.fromWeek < weekIso)
  return { ...series, changes: [...earlier, { fromWeek: weekIso, ...time }] }
}

/**
 * Change one occurrence (`scope` "this": cancel or move only that week) or this and every later
 * occurrence (`scope` "following": a new day and time from that week on). Earlier weeks, past
 * sessions and published rosters are never rewritten; `skipped` counts published rosters left as
 * they were, which officers update and republish themselves.
 * @param {{ cancelled?: boolean, day?: number, minutes?: number }} change
 * @param {'this' | 'following'} scope
 * @returns {{ state: import('./model.js').AppState, skipped: number, error?: string }}
 */
export function changeSeriesOccurrence(state, raidId, weekIso, change, scope, { now = Date.now() } = {}) {
  const raid = state.settings.raids.find((r) => r.id === raidId)
  if (!raid?.series) return { state, skipped: 0, error: 'This raid has no weekly schedule.' }
  if (scope !== 'this' && scope !== 'following')
    return { state, skipped: 0, error: 'Choose this raid or this and following raids.' }
  const occurrence = seriesOccurrences(raid.series).find((o) => o.weekIso === weekIso)
  if (!occurrence) return { state, skipped: 0, error: 'That week is not part of this schedule.' }
  if (occurrence.start !== null && occurrence.start <= now)
    return { state, skipped: 0, error: 'That raid is in the past and cannot be changed.' }

  const updated = changedSeries(raid.series, weekIso, change, scope)
  const error = validateRaidSeries(updated) ?? hoursError(state, raid, updated)
  if (error) return { state, skipped: 0, error }

  let next = withSeries(state, raidId, updated)
  let skipped = 0
  const affected = seriesOccurrences(updated).filter((o) =>
    scope === 'this' ? o.weekIso === weekIso : o.weekIso >= weekIso,
  )
  for (const item of affected) {
    const result = applyToPlan(next, raidId, item, now)
    next = result.state
    if (result.skipped) skipped += 1
  }
  return { state: next, skipped }
}

function planStatus(plan) {
  if (plan.cancelled) return 'cancelled'
  if (!plan.published) return 'draft'
  return plan.published.start === plan.start ? 'published' : 'draft'
}

/**
 * Raids in a calendar month (`YYYY-MM`), dated in the guild timezone: saved plans with their actual
 * times, plus schedule dates that have no plan yet. With `publishedOnly`, just published rosters at
 * their published times, as players see them.
 * @returns {{ raidId: string, raidName: string, weekIso: string, dateIso: string, start: number, status: string }[]}
 */
export function raidMonthEntries(state, month, { publishedOnly = false } = {}) {
  const zone = state.guild.timezone
  const names = new Map(state.settings.raids.map((raid) => [raid.id, raid.name]))
  const entries = []
  const add = (raidId, weekIso, start, status) => {
    const dateIso = wallTime(start, zone).dateIso
    if (dateIso.startsWith(`${month}-`))
      entries.push({ raidId, raidName: names.get(raidId), weekIso, dateIso, start, status })
  }
  for (const [weekIso, week] of Object.entries(state.weeks)) {
    for (const [raidId, plan] of Object.entries(week.plans)) {
      if (!names.has(raidId)) continue
      if (!publishedOnly) add(raidId, weekIso, plan.start, planStatus(plan))
      else if (plan.published)
        add(raidId, weekIso, plan.published.start, plan.cancelled ? 'cancelled' : 'published')
    }
  }
  if (publishedOnly) return entries.sort((a, b) => a.start - b.start)
  for (const raid of state.settings.raids.filter((r) => r.series)) {
    for (const occurrence of seriesOccurrences(raid.series)) {
      if (occurrence.start === null || own(state.weeks[occurrence.weekIso]?.plans, raid.id)) continue
      add(raid.id, occurrence.weekIso, occurrence.start, occurrence.cancelled ? 'cancelled' : 'scheduled')
    }
  }
  return entries.sort((a, b) => a.start - b.start)
}
