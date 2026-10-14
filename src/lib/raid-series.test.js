import { describe, expect, test } from 'vitest'
import {
  changeSeriesOccurrence,
  generateSeriesDrafts,
  raidMonthEntries,
  saveRaidSeries,
  seriesOccurrences,
  validateRaidSeries,
} from './raid-series.js'
import { wallTime } from './time.js'

const now = Date.parse('2026-10-01T00:00:00Z')
const series = {
  startDate: '2026-10-05',
  endDate: '2026-11-09',
  day: 0,
  minutes: 19 * 60,
  timezone: 'America/New_York',
}
const fixture = (schedule = series) => ({
  currentWeek: '2026-10-05',
  currentRaidId: 'raid-a',
  guild: { timezone: 'America/New_York', dayStartHour: 18, slotsPerDay: 12 },
  settings: { raids: [{ id: 'raid-a', name: 'Progression', durationSlots: 6, series: schedule }] },
  weeks: {},
})

describe('weekly raid series', () => {
  test('keeps the local time across DST and includes both range endpoints', () => {
    const occurrences = seriesOccurrences(series)
    expect(occurrences).toHaveLength(6)
    expect(occurrences.map((o) => wallTime(o.start, series.timezone).minutes)).toEqual(Array(6).fill(1140))
    expect(new Date(occurrences[0].start).getUTCHours()).toBe(23)
    expect(new Date(occurrences[5].start).getUTCHours()).toBe(0)
  })

  test('rejects malformed, unbounded, overlapping or ambiguous rules', () => {
    expect(validateRaidSeries(series)).toBeNull()
    for (const bad of [
      { ...series, endDate: '2027-11-09' },
      { ...series, startDate: '2026-02-30' },
      { ...series, timezone: 'Nowhere' },
      { ...series, minutes: 1141 },
      { ...series, day: 7 },
      { ...series, changes: [{ fromWeek: '2026-10-06', day: 1, minutes: 1140 }] },
      { ...series, exceptions: { constructor: { cancelled: true } } },
    ])
      expect(validateRaidSeries(bad)).toBeTruthy()
  })

  test('flags a nonexistent DST wall time instead of moving it silently', () => {
    const [occurrence] = seriesOccurrences({
      ...series,
      startDate: '2026-03-08',
      endDate: '2026-03-08',
      day: 6,
      minutes: 150,
    })
    expect(occurrence.start).toBeNull()
    expect(occurrence.error).toMatch(/clock change/i)
  })

  test('overnight starts retain the original planning week and show the actual date', () => {
    const [occurrence] = seriesOccurrences({
      ...series,
      startDate: '2026-10-11',
      endDate: '2026-10-11',
      day: 6,
      minutes: 1500,
    })
    expect(occurrence.weekIso).toBe('2026-10-05')
    expect(occurrence.dateIso).toBe('2026-10-12')
    expect(wallTime(occurrence.start, series.timezone).minutes).toBe(60)
  })

  test('requires the requested times to fit guild hours rather than clamping them', () => {
    const state = fixture()
    expect(saveRaidSeries(state, 'raid-a', { ...series, minutes: 22 * 60 }).error).toMatch(/planning hours/i)
    expect(saveRaidSeries(state, 'raid-a', series).state.settings.raids[0].series).toEqual(series)
    expect(state.settings.raids[0].series).toBe(series)
  })

  test('generates only missing future drafts and preserves check-ins and all existing plans', () => {
    const state = fixture()
    const published = { start: 1, team: [], published: { start: 1, team: [] } }
    const manual = { start: 2, team: [] }
    state.weeks = {
      '2026-10-05': { checkins: { m1: { checkedIn: true } }, plans: { 'raid-a': published } },
      '2026-10-12': { checkins: {}, plans: { 'raid-a': manual } },
    }
    const result = generateSeriesDrafts(state, 'raid-a', { now: Date.parse('2026-10-14T00:00:00Z') })
    expect(result.created).toBe(4)
    expect(result.state.weeks['2026-10-05']).toBe(state.weeks['2026-10-05'])
    expect(result.state.weeks['2026-10-12'].plans['raid-a']).toBe(manual)
    expect(result.state.weeks['2026-10-19'].plans['raid-a']).toMatchObject({ team: [], published: null })
    expect(generateSeriesDrafts(result.state, 'raid-a', { now }).created).toBe(0)
  })

  test('one cancellation is an exception, and following edits preserve earlier weeks and published rosters', () => {
    let state = generateSeriesDrafts(fixture(), 'raid-a', { now }).state
    const oldPlan = state.weeks['2026-10-05'].plans['raid-a']
    const published = state.weeks['2026-11-02'].plans['raid-a']
    published.published = { start: published.start, team: [] }
    const cancelled = changeSeriesOccurrence(state, 'raid-a', '2026-10-12', { cancelled: true }, 'this', {
      now,
    })
    expect(cancelled.state.weeks['2026-10-12'].plans['raid-a'].cancelled).toBe(true)
    expect(cancelled.state.weeks['2026-10-19'].plans['raid-a'].cancelled).toBe(false)
    state = cancelled.state
    const moved = changeSeriesOccurrence(
      state,
      'raid-a',
      '2026-10-19',
      { day: 1, minutes: 1200 },
      'following',
      { now },
    )
    expect(moved.state.weeks['2026-10-05'].plans['raid-a']).toBe(oldPlan)
    expect(moved.state.weeks['2026-11-02'].plans['raid-a']).toBe(published)
    expect(moved.skipped).toBe(1)
    expect(wallTime(moved.state.weeks['2026-10-26'].plans['raid-a'].start, series.timezone)).toEqual({
      dateIso: '2026-10-27',
      minutes: 1200,
    })
  })

  test('scoped edits refuse to rewrite past sessions and cannot choose a different week identity', () => {
    const state = generateSeriesDrafts(fixture(), 'raid-a', { now }).state
    expect(
      changeSeriesOccurrence(state, 'raid-a', '2026-10-05', { minutes: 1200 }, 'this', {
        now: Date.parse('2026-10-06T12:00:00Z'),
      }).error,
    ).toMatch(/past/i)
    expect(
      changeSeriesOccurrence(state, 'raid-a', '2026-10-06', { minutes: 1200 }, 'this', { now }).error,
    ).toMatch(/week/i)
  })
})

describe('month calendar', () => {
  test('combines raid profiles, actual saved times, cancellations and unpublished series dates', () => {
    const state = fixture()
    state.settings.raids.push({ id: 'raid-b', name: 'Social', durationSlots: 4 })
    state.weeks['2026-10-05'] = {
      checkins: {},
      plans: {
        'raid-a': {
          start: Date.parse('2026-10-06T23:00:00Z'),
          team: [],
          published: { start: Date.parse('2026-10-06T23:00:00Z'), team: [] },
        },
        'raid-b': { start: Date.parse('2026-10-08T23:00:00Z'), team: [], cancelled: true },
      },
    }
    const entries = raidMonthEntries(state, '2026-10')
    expect(entries).toHaveLength(5)
    expect(entries[0]).toMatchObject({
      raidId: 'raid-a',
      weekIso: '2026-10-05',
      dateIso: '2026-10-06',
      status: 'published',
    })
    expect(entries[1]).toMatchObject({ raidId: 'raid-b', status: 'cancelled' })
    expect(entries[2]).toMatchObject({ status: 'scheduled' })
    expect(raidMonthEntries(state, '2026-10', { publishedOnly: true })).toHaveLength(1)
  })

  test('player calendar uses the publication snapshot when the draft has moved', () => {
    const state = fixture()
    state.weeks['2026-10-05'] = {
      checkins: {},
      plans: {
        'raid-a': {
          start: Date.parse('2026-10-07T23:00:00Z'),
          team: [],
          published: { start: Date.parse('2026-10-06T23:00:00Z'), team: [] },
        },
      },
    }
    expect(raidMonthEntries(state, '2026-10', { publishedOnly: true })[0].dateIso).toBe('2026-10-06')
    expect(raidMonthEntries(state, '2026-10')[0].status).toBe('draft')
  })
})
