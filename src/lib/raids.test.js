import { describe, expect, test } from 'vitest'
import { getRaid, setCurrentRaid } from './raids.js'
import { createSeedState, SEED_WEEK } from './seed.js'
import { deleteCharacter, getWeek, saveSettings, setPlan } from './model.js'
import { applySettings, benchHistory, plannerContext } from './planning.js'
import { setAttendance } from './attendance.js'
import { removeMember } from './members.js'
import { parseBackup, backupJson, migrateState } from './storage.js'
import { diffRows, rowsToState, stateToRows } from './remote/rows.js'
import { rosterIcs } from './calendar.js'
import { formatHash, parseHash } from './route.js'

const TEN = 'raid-10-1'
const TWENTY = 'raid-20'
const entry = { memberId: 'm0', characterId: 'c0b', role: 'Healer' }

function planned() {
  let state = createSeedState()
  const { plan } = plannerContext(state)
  for (const raidId of [TEN, TWENTY]) {
    state = setPlan(setCurrentRaid(state, raidId), SEED_WEEK, {
      start: plan.start,
      team: [entry],
      locked: ['m0'],
      attendance: { m0: 'late' },
    })
  }
  return state
}

describe('independent raids', () => {
  test('switches between two 10-player raids and one 20-player raid without overwriting a roster', () => {
    const state = planned()
    const changed = setPlan(setCurrentRaid(state, TEN), SEED_WEEK, { start: 0, team: [] })
    expect(getWeek(changed, SEED_WEEK).plan.team).toEqual([])
    expect(getWeek(setCurrentRaid(changed, TWENTY), SEED_WEEK).plan).toEqual(getWeek(state, SEED_WEEK).plan)
    expect(getRaid(setCurrentRaid(state, TEN)).targets).toEqual([2, 2, 6])
    expect(plannerContext(setCurrentRaid(createSeedState(), TEN)).plan.team).toHaveLength(10)
    expect(setCurrentRaid(state, 'unknown')).toBe(state)
  })

  test('compositions, duration, attendance, and bench fairness are scoped to a raid', () => {
    const state = setCurrentRaid(planned(), TEN)
    const { state: next, error } = applySettings(state, {
      targets: [1, 3, 6],
      durationSlots: 4,
      raidName: 'First raid',
    })
    expect(error).toBeUndefined()
    expect(getRaid(next)).toMatchObject({ targets: [1, 3, 6], durationSlots: 4, name: 'First raid' })
    expect(getRaid(next, TWENTY)).toEqual(getRaid(state, TWENTY))
    expect(next.weeks[SEED_WEEK].plans[TWENTY]).toEqual(state.weeks[SEED_WEEK].plans[TWENTY])
    const marked = setAttendance(next, SEED_WEEK, 'm0', 'attended')
    expect(marked.weeks[SEED_WEEK].plans[TWENTY].attendance.m0).toBe('late')
    expect(benchHistory(setCurrentRaid(state, 'raid-10-2'), '2026-10-05').size).toBe(0)
  })

  test('rejects a composition that does not fit the selected raid', () => {
    const state = setCurrentRaid(createSeedState(), TEN)
    const result = saveSettings(state, { targets: [2, 4, 14] })
    expect(result.error).toMatch(/total 10/)
    expect(result.state).toBe(state)
  })

  test('guild hour changes realign every raid while preserving attendance', () => {
    const state = planned()
    const { state: next, error } = applySettings(state, { timezone: 'America/New_York' })
    expect(error).toBeUndefined()
    for (const raidId of [TEN, TWENTY]) {
      expect(next.weeks[SEED_WEEK].plans[raidId].start).toBe(
        state.weeks[SEED_WEEK].plans[raidId].start - 3 * 3600000,
      )
      expect(next.weeks[SEED_WEEK].plans[raidId].attendance).toEqual({ m0: 'late' })
    }
  })

  test('removing members or characters cleans every raid roster and lock', () => {
    for (const state of [
      removeMember(planned(), 'm0').state,
      deleteCharacter(planned(), 'm0', 'c0b').state,
    ]) {
      for (const plan of Object.values(state.weeks[SEED_WEEK].plans)) {
        expect(plan).toMatchObject({ team: [], locked: [], attendance: {} })
      }
    }
  })

  test('backups and online rows preserve all raids and use distinct plan keys', () => {
    const state = setCurrentRaid(planned(), TEN)
    expect(parseBackup(backupJson(state)).state).toEqual(state)
    const rows = stateToRows(state, 'guild')
    const reloaded = rowsToState(rows, state)
    expect(reloaded.weeks).toEqual(state.weeks)
    expect(reloaded.currentRaidId).toBe(TEN)
    expect(diffRows(rows, stateToRows(setCurrentRaid(state, TWENTY), 'guild'))).toEqual([])
    const changed = setAttendance(state, SEED_WEEK, 'm0', 'noshow')
    const [op] = diffRows(rows, stateToRows(changed, 'guild'))
    expect(op.rows).toHaveLength(1)
    expect(op.rows[0].raid_id).toBe(TEN)
  })

  test('v5 migration keeps the existing custom composition, roster, locks, and attendance', () => {
    const state = planned()
    const legacy = {
      ...state,
      version: 5,
      settings: { targets: [1, 2, 7], durationSlots: 4, checkinDeadline: null },
      weeks: {
        [SEED_WEEK]: { checkins: state.weeks[SEED_WEEK].checkins, plan: getWeek(state, SEED_WEEK).plan },
      },
    }
    const migrated = migrateState(legacy)
    expect(getRaid(migrated)).toMatchObject({ size: 10, targets: [1, 2, 7], durationSlots: 4 })
    expect(getWeek(migrated, SEED_WEEK).plan).toEqual(legacy.weeks[SEED_WEEK].plan)
    expect(parseBackup(JSON.stringify(legacy)).state).toEqual(migrated)
  })

  test('calendar events and shared links distinguish raids in the same week', () => {
    const state = planned()
    const plan = plannerContext(state).plan
    const uid = (s) => rosterIcs(s, plan).match(/UID:([^\r]+)/)[1]
    expect(uid(state)).not.toBe(uid(setCurrentRaid(state, TEN)))
    expect(parseHash(formatHash('planner', SEED_WEEK, TEN))).toEqual({
      view: 'planner',
      week: SEED_WEEK,
      raid: TEN,
    })
  })
})
