import { beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_CHECKIN_DEADLINE } from './guild.js'
import { createSeedState } from './seed.js'
import { STATE_VERSION } from './model.js'
import {
  backupJson,
  clearState,
  loadSaved,
  loadState,
  migrateState,
  parseBackup,
  saveState,
  UNREADABLE_KEY,
  unreadableReason,
  watchOtherTabs,
} from './storage.js'

const RANGE = { start: 1000, end: 2000 }

function v3State(checkins) {
  const { version: _version, weeks: _weeks, ...rest } = v4State()
  return { ...rest, version: 3, weeks: { '2026-10-05': { checkins, plan: null } } }
}

/** State as saved by the previous build: no Discord IDs, no deadline. */
function v4State() {
  const seed = createSeedState()
  const settings = { targets: [2, 4, 14], durationSlots: 6 }
  return {
    ...seed,
    version: 4,
    members: seed.members.map(({ discordId: _id, ...m }) => m),
    settings,
    weeks: Object.fromEntries(
      Object.entries(seed.weeks).map(([iso, week]) => [iso, { checkins: week.checkins, plan: null }]),
    ),
  }
}

describe('migrateState', () => {
  test('v3 submitted check-ins stay checked in', () => {
    const migrated = migrateState(v3State({ m0: { submitted: true, ranges: [RANGE], declined: [] } }))
    expect(migrated.version).toBe(STATE_VERSION)
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
    expect(migrated.version).toBe(STATE_VERSION)
    expect(migrated.members.every((m) => m.discordId === '')).toBe(true)
    expect(migrated.settings.checkinDeadline).toEqual(DEFAULT_CHECKIN_DEADLINE)
    expect(migrated.settings.raids.find((raid) => raid.id === 'raid-20').targets).toEqual([2, 4, 14])
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
    expect(loaded.version).toBe(STATE_VERSION)
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

describe('loadSaved', () => {
  beforeEach(() => localStorage.clear())

  test('returns nothing unreadable when storage is empty', () => {
    expect(loadSaved()).toEqual({ state: null, unreadable: null })
    expect(localStorage.getItem(UNREADABLE_KEY)).toBeNull()
  })

  test('returns a usable save as state', () => {
    saveState(createSeedState())
    expect(loadSaved().state).toEqual(createSeedState())
  })

  test('keeps a copy of unreadable data so a new setup cannot overwrite it', () => {
    localStorage.setItem('whentoraid-v3', '{not json')
    expect(loadSaved()).toEqual({ state: null, unreadable: '{not json' })
    expect(localStorage.getItem(UNREADABLE_KEY)).toBe('{not json')

    saveState(createSeedState())
    expect(localStorage.getItem(UNREADABLE_KEY)).toBe('{not json')
  })
})

describe('unreadableReason', () => {
  test('names a save from a newer version', () => {
    expect(unreadableReason(JSON.stringify({ version: 99 }))).toMatch(/newer version/)
  })

  test('names damaged and incomplete data', () => {
    expect(unreadableReason('{oops')).toMatch(/damaged/)
    expect(unreadableReason('{"version": 5}')).toMatch(/missing/)
  })
})

describe('saveState', () => {
  beforeEach(() => localStorage.clear())

  test('skips writing when nothing changed', () => {
    const state = createSeedState()
    saveState(state)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    expect(saveState(state)).toBe(true)
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })
})

describe('backups', () => {
  test('round-trip a guild', () => {
    const state = createSeedState()
    expect(parseBackup(backupJson(state))).toEqual({ state })
  })

  test('upgrade backups saved by older versions', () => {
    expect(parseBackup(JSON.stringify(v4State())).state.version).toBe(STATE_VERSION)
  })

  test('reject files that are not backups', () => {
    expect(parseBackup('')).toEqual({ error: 'That file is not a WhenToRaid backup. The file is empty.' })
    expect(parseBackup('{"hello": 1}').error).toMatch(/not a WhenToRaid backup/)
  })
})

describe('watchOtherTabs', () => {
  function fire(key, newValue) {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
  }

  test('reports saves and clears from other tabs, and ignores other keys and unreadable data', () => {
    const changes = []
    const stop = watchOtherTabs((state) => changes.push(state))
    const state = createSeedState()

    fire('whentoraid-v3', JSON.stringify(state))
    fire('something-else', '{}')
    fire('whentoraid-v3', '{not json')
    fire('whentoraid-v3', null)
    stop()
    fire('whentoraid-v3', null)

    expect(changes).toEqual([state, null])
  })
})
