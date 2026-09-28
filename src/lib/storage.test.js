import { beforeEach, describe, expect, test } from 'vitest'
import { createSeedState } from './seed.js'
import { loadState, migrateState, saveState } from './storage.js'

const RANGE = { start: 1000, end: 2000 }

function v3State(checkins) {
  const { version: _version, weeks: _weeks, ...rest } = createSeedState()
  return { ...rest, version: 3, weeks: { '2026-10-05': { checkins, plan: null } } }
}

describe('migrateState', () => {
  test('v3 submitted check-ins stay checked in', () => {
    const migrated = migrateState(v3State({ m0: { submitted: true, ranges: [RANGE], declined: [] } }))
    expect(migrated.version).toBe(4)
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

  test('current and unknown versions pass through unchanged', () => {
    const current = createSeedState()
    expect(migrateState(current)).toBe(current)
    expect(migrateState(null)).toBe(null)
  })
})

describe('loadState', () => {
  beforeEach(() => localStorage.clear())

  test('round-trips current state', () => {
    const state = createSeedState()
    expect(saveState(state)).toBe(true)
    expect(loadState()).toEqual(state)
  })

  test('upgrades v3 data saved by the previous build', () => {
    localStorage.setItem(
      'whentoraid-v3',
      JSON.stringify(v3State({ m0: { submitted: false, ranges: [RANGE], declined: [] } })),
    )
    const loaded = loadState()
    expect(loaded.version).toBe(4)
    expect(loaded.weeks['2026-10-05'].checkins.m0.checkedIn).toBe(true)
  })

  test('returns null for corrupt data', () => {
    localStorage.setItem('whentoraid-v3', '{not json')
    expect(loadState()).toBeNull()
  })
})
