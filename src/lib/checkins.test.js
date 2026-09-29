import { describe, expect, test } from 'vitest'
import { attendanceRecord, formatRecord, setAttendance, setCancelled } from './attendance.js'
import { deadlineUtc, reminderDiscord, waitingOn } from './checkins.js'
import { getWeek, markUnavailable, setPlan } from './model.js'
import { benchHistory } from './planning.js'
import { createSeedState, SEED_WEEK } from './seed.js'
import { addDays } from './time.js'

const NEXT_WEEK = addDays(SEED_WEEK, 7)
const DISCORD_ID = '123456789012345678'

describe('check-in reminders', () => {
  test('waitingOn lists members who have not answered; "can’t make it" counts as an answer', () => {
    let state = createSeedState()
    expect(waitingOn(state, SEED_WEEK)).toEqual([])
    expect(waitingOn(state, NEXT_WEEK)).toHaveLength(24)
    state = markUnavailable(state, NEXT_WEEK, 'm0')
    expect(waitingOn(state, NEXT_WEEK).map((m) => m.id)).not.toContain('m0')
  })

  test('the deadline is the configured weekday and time in guild time', () => {
    // Wednesday Sep 30, 6 pm in Los Angeles (UTC-7) is Oct 1, 01:00 UTC.
    expect(deadlineUtc(createSeedState(), SEED_WEEK)).toBe(Date.UTC(2026, 9, 1, 1, 0))
    const none = { ...createSeedState(), settings: { ...createSeedState().settings, checkinDeadline: null } }
    expect(deadlineUtc(none, SEED_WEEK)).toBeNull()
  })

  test('the reminder mentions members with Discord IDs and names the rest safely', () => {
    const seed = createSeedState()
    const state = {
      ...seed,
      members: [
        { ...seed.members[0], discordId: DISCORD_ID },
        { ...seed.members[1], name: '@everyone *hi*' },
      ],
    }
    const text = reminderDiscord(state, NEXT_WEEK)
    expect(text).toContain(`<@${DISCORD_ID}>`)
    expect(text).not.toContain('@everyone')
    expect(text).toContain('\\*hi\\*')
    const deadline = Math.floor(deadlineUtc(state, NEXT_WEEK) / 1000)
    expect(text).toContain(`<t:${deadline}:F> (<t:${deadline}:R>)`)
  })

  test('there is nothing to send when everyone has answered', () => {
    expect(reminderDiscord(createSeedState(), SEED_WEEK)).toBeNull()
  })
})

describe('attendance', () => {
  const team = [
    { memberId: 'm1', characterId: 'c1a', role: 'Tank' },
    { memberId: 'm2', characterId: 'c2a', role: 'Healer' },
  ]
  const planned = () => setPlan(createSeedState(), SEED_WEEK, { start: 0, team })

  test('records and clears attendance for rostered members only', () => {
    let state = setAttendance(planned(), SEED_WEEK, 'm1', 'late')
    expect(getWeek(state, SEED_WEEK).plan.attendance).toEqual({ m1: 'late' })
    state = setAttendance(state, SEED_WEEK, 'm1', null)
    expect(getWeek(state, SEED_WEEK).plan.attendance).toEqual({})
    const benched = planned()
    expect(setAttendance(benched, SEED_WEEK, 'm5', 'attended')).toBe(benched)
  })

  test('needs a saved plan', () => {
    const state = createSeedState()
    expect(setAttendance(state, SEED_WEEK, 'm1', 'attended')).toBe(state)
    expect(setCancelled(state, SEED_WEEK, true)).toBe(state)
  })

  test('the record counts recent weeks and skips cancelled raids', () => {
    let state = setAttendance(planned(), SEED_WEEK, 'm1', 'attended')
    state = setPlan(state, NEXT_WEEK, { start: 0, team })
    state = setAttendance(state, NEXT_WEEK, 'm1', 'noshow')
    expect(attendanceRecord(state, NEXT_WEEK, 'm1')).toEqual({ attended: 1, late: 0, noshow: 1 })
    expect(attendanceRecord(state, NEXT_WEEK, 'm1', 1)).toEqual({ attended: 0, late: 0, noshow: 1 })

    state = setCancelled(state, NEXT_WEEK, true)
    expect(attendanceRecord(state, NEXT_WEEK, 'm1')).toEqual({ attended: 1, late: 0, noshow: 0 })
  })

  test('formatRecord summarizes, or returns null when nothing is recorded', () => {
    expect(formatRecord({ attended: 5, late: 1, noshow: 0 })).toBe('5 attended · 1 late · 0 no-show')
    expect(formatRecord({ attended: 0, late: 0, noshow: 0 })).toBeNull()
  })

  test('a cancelled raid does not count as sitting out', () => {
    const history = (cancelled) => {
      const planned = setPlan(createSeedState(), SEED_WEEK, {
        // Fri Oct 2, 6:30–9:30 pm in Los Angeles: the sample guild's strong night.
        start: Date.UTC(2026, 9, 3, 1, 30),
        team: [],
        cancelled,
      })
      return benchHistory(planned, NEXT_WEEK)
    }
    expect(history(false).size).toBeGreaterThan(0)
    expect(history(true).size).toBe(0)
  })
})
