import { beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_CHECKIN_DEADLINE } from './guild.js'
import { createSeedState } from './seed.js'
import { clearState, loadState, migrateState, saveState } from './storage.js'

const RANGE = { start: 1000, end: 2000 }

function v3State(checkins) {
  const { version: _version, weeks: _weeks, ...rest } = v4State()
  return { ...rest, version: 3, weeks: { '2026-10-05': { checkins, plan: null } } }
}

/** State as saved by the previous build: no Discord IDs, no deadline. */
function v4State() {
  const seed = createSeedState()
  const { checkinDeadline: _deadline, ...settings } = seed.settings
  return {
    ...seed,
    version: 4,
    members: seed.members.map(({ discordId: _id, ...m }) => m),
    settings,
  }
}

describe('migrateState', () => {
  test('v3 submitted check-ins stay checked in', () => {
    const migrated = migrateState(v3State({ m0: { submitted: true, ranges: [RANGE], declined: [] } }))
    expect(migrated.version).toBe(5)
    expect(migrated.weeks['2026-10-05'].checkins.m0).toEqual({
      checkedIn: true,
      ranges: [RANGE],
      declined: [],
    })
  })

  test('v3 drafts with edits count as checked in; untouched ones do not', () => {
    const migrated = migrateState(
      v3State({
        m0: { submitted: false, ranges: [RANGE], declined: [] },
        m1: { submitted: false, ranges: [], declined: ['c1a'] },
        m2: { submitted: false, ranges: [], declined: [] },
      }),
    )
    const { checkins } = migrated.weeks['2026-10-05']
    expect(checkins.m0.checkedIn).toBe(true)
    expect(checkins.m1.checkedIn).toBe(true)
    expect(checkins.m2.checkedIn).toBe(false)
    expect('submitted' in checkins.m0).toBe(false)
  })

  test('v4 gains blank Discord IDs and the default check-in deadline', () => {
    const migrated = migrateState(v4State())
    expect(migrated.version).toBe(5)
    expect(migrated.members.every((m) => m.discordId === '')).toBe(true)
    expect(migrated.settings.checkinDeadline).toEqual(DEFAULT_CHECKIN_DEADLINE)
    expect(migrated.settings.targets).toEqual([2, 4, 14])
  })

  test('v4 migration keeps values that are already present', () => {
    const state = v4State()
    const withId = { ...state, members: [{ ...state.members[0], discordId: '123456789012345678' }] }
    expect(migrateState(withId).members[0].discordId).toBe('123456789012345678')
  })

  test('current and unknown versions pass through unchanged', () => {
    const current = createSeedState()
    expect(migrateState(current)).toBe(current)
    expect(migrateState(null)).toBe(null)
    const future = { version: 99 }
    expect(migrateState(future)).toBe(future)
  })
})

describe('loadState', () => {
  beforeEach(() => localStorage.clear())

  test('round-trips current state', () => {
    const state = createSeedState()
    expect(saveState(state)).toBe(true)
    expect(loadState()).toEqual(state)
  })

  test('upgrades v3 data saved by an earlier build', () => {
    localStorage.setItem(
      'whentoraid-v3',
      JSON.stringify(v3State({ m0: { submitted: false, ranges: [RANGE], declined: [] } })),
    )
    const loaded = loadState()
    expect(loaded.version).toBe(5)
    expect(loaded.weeks['2026-10-05'].checkins.m0.checkedIn).toBe(true)
  })

  test('returns null for corrupt data', () => {
    localStorage.setItem('whentoraid-v3', '{not json')
    expect(loadState()).toBeNull()
  })

  test('clearState forgets the saved guild', () => {
    saveState(createSeedState())
    expect(clearState()).toBe(true)
    expect(loadState()).toBeNull()
  })
})
