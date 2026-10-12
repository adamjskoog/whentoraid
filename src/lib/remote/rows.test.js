import { describe, expect, test } from 'vitest'
import { markUnavailable, retireCharacter, setPlan } from '../model.js'
import { removeMember } from '../members.js'
import { createSeedState, SEED_WEEK } from '../seed.js'
import { diffRows, mergeRows, recentRows, rowsToState, stableJson, stateToRows } from './rows.js'

const GUILD = '8a3e0f52-0000-4000-8000-000000000001'

/** Rows as Postgres returns them: jsonb reorders object keys. */
function throughJsonb(rows) {
  const reorder = (value) =>
    Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([k, v]) => [k, reorder(v)]),
          )
        : value
  return Object.fromEntries(Object.entries(rows).map(([table, list]) => [table, list.map(reorder)]))
}

describe('stateToRows and rowsToState', () => {
  test('round-trip a whole guild', () => {
    const state = {
      ...createSeedState(),
      members: createSeedState().members.map((m, i) => ({ ...m, officer: i === 0 })),
    }
    const viewer = { currentWeek: state.currentWeek, currentMemberId: state.currentMemberId }
    expect(rowsToState(stateToRows(state, GUILD), viewer)).toEqual(state)
  })

  test('keep member and character order, which the optimizer uses for ties', () => {
    const rows = stateToRows(createSeedState(), GUILD)
    const shuffled = {
      ...rows,
      members: [...rows.members].reverse(),
      characters: [...rows.characters].reverse(),
    }
    const state = rowsToState(shuffled, { currentWeek: SEED_WEEK, currentMemberId: 'm0' })
    expect(state.members.map((m) => m.id)).toEqual(createSeedState().members.map((m) => m.id))
  })

  test('fall back to the first member when the viewer’s member is gone', () => {
    const rows = stateToRows(createSeedState(), GUILD)
    const state = rowsToState(rows, { currentWeek: SEED_WEEK, currentMemberId: 'missing' })
    expect(state.currentMemberId).toBe(rows.members[0].id)
  })

  test('the week and acting-as player are per viewer and never stored', () => {
    const state = createSeedState()
    const moved = { ...state, currentWeek: '2026-11-02', currentMemberId: state.members[3].id }
    expect(diffRows(stateToRows(state, GUILD), stateToRows(moved, GUILD))).toEqual([])
  })
})

describe('diffRows', () => {
  const before = createSeedState()
  const rowsBefore = stateToRows(before, GUILD)

  test('sends only the changed check-in', () => {
    const memberId = before.members[2].id
    const after = markUnavailable(before, SEED_WEEK, memberId)
    const ops = diffRows(rowsBefore, stateToRows(after, GUILD))
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ table: 'checkins', kind: 'upsert' })
    expect(ops[0].rows.map((r) => r.member_id)).toEqual([memberId])
  })

  test('updates the guild row rather than upserting it', () => {
    const after = { ...before, guild: { ...before.guild, name: 'Renamed' } }
    expect(diffRows(rowsBefore, stateToRows(after, GUILD))).toEqual([
      { table: 'guilds', kind: 'update', rows: [expect.objectContaining({ id: GUILD, name: 'Renamed' })] },
    ])
  })

  test('removes a player’s rows children first, after any writes', () => {
    const memberId = before.members[5].id
    const after = removeMember(before, memberId).state
    const ops = diffRows(rowsBefore, stateToRows(after, GUILD))
    const deletes = ops.filter((op) => op.kind === 'delete').map((op) => op.table)
    expect(deletes).toEqual(['checkins', 'characters', 'members'])
    expect(ops.findIndex((op) => op.kind === 'delete')).toBe(ops.length - deletes.length)
    expect(ops.find((op) => op.table === 'members' && op.kind === 'delete').keys).toEqual([
      { guild_id: GUILD, id: memberId },
    ])
  })

  test('retiring a rostered character writes only its player’s own rows', () => {
    // Players may write only their own characters, never plans, so anything more would be refused.
    const team = [
      { memberId: 'm1', characterId: 'c1a', role: 'Tank' },
      { memberId: 'm0', characterId: 'c0a', role: 'Tank' },
    ]
    const planned = setPlan(before, SEED_WEEK, { start: 0, team, locked: ['m0'] })
    const after = retireCharacter(planned, 'm0', 'c0a').state
    const ops = diffRows(stateToRows(planned, GUILD), stateToRows(after, GUILD))
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ table: 'characters', kind: 'upsert' })
    expect(ops[0].rows.map((r) => [r.id, r.member_id, r.main, r.retired])).toEqual([
      ['c0a', 'm0', false, true],
      ['c0b', 'm0', true, false],
    ])
  })

  test('round-trips a retired character', () => {
    const retired = retireCharacter(before, 'm0', 'c0b').state
    const reloaded = rowsToState(stateToRows(retired, GUILD), retired)
    expect(reloaded.characters).toEqual(retired.characters)
  })

  test('adds a plan', () => {
    const after = setPlan(before, '2026-10-05', { start: 1000, team: [] })
    const [op] = diffRows(rowsBefore, stateToRows(after, GUILD))
    expect(op).toMatchObject({ table: 'plans', kind: 'upsert', rows: [{ week: '2026-10-05', start: 1000 }] })
  })

  test('ignores key order from jsonb', () => {
    const fromDatabase = throughJsonb(rowsBefore)
    const reloaded = rowsToState(fromDatabase, {
      currentWeek: SEED_WEEK,
      currentMemberId: before.currentMemberId,
    })
    expect(diffRows(rowsBefore, stateToRows(reloaded, GUILD))).toEqual([])
  })
})

describe('helpers', () => {
  test('stableJson sorts keys at every level', () => {
    expect(stableJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}')
  })

  test('recentRows keeps check-ins from the given week on', () => {
    const rows = {
      guilds: [],
      members: [],
      characters: [],
      plans: [],
      checkins: [{ week: '2026-01-05' }, { week: '2026-09-28' }],
    }
    expect(recentRows(rows, '2026-07-06').checkins).toEqual([{ week: '2026-09-28' }])
  })
})

describe('mergeRows', () => {
  const base = stateToRows(createSeedState(), GUILD)
  const change = (rows, index, name) => ({
    ...rows,
    members: rows.members.map((row, i) => (i === index ? { ...row, name } : row)),
  })

  test('keeps independent local and remote row edits', () => {
    const merged = mergeRows(base, change(base, 0, 'Local'), change(base, 1, 'Remote'))
    expect(merged.members[0].name).toBe('Local')
    expect(merged.members[1].name).toBe('Remote')
  })

  test('identical concurrent changes are already saved', () => {
    const edited = change(base, 0, 'Same')
    expect(diffRows(edited, mergeRows(base, edited, throughJsonb(edited)))).toEqual([])
  })

  test('an explicitly reviewed recovery replaces only locally changed rows', () => {
    const server = change(change(base, 0, 'Their conflict'), 1, 'Their independent edit')
    const merged = mergeRows(base, change(base, 0, 'My reviewed edit'), server, { reviewed: true })
    expect(merged.members[0].name).toBe('My reviewed edit')
    expect(merged.members[1].name).toBe('Their independent edit')
  })

  test('a divergent edit to the same row is a conflict, including deletion', () => {
    expect(() => mergeRows(base, change(base, 0, 'Local'), change(base, 0, 'Remote'))).toThrow(/same record/)
    const deleted = { ...base, members: base.members.slice(1) }
    expect(() => mergeRows(base, change(base, 0, 'Local'), deleted)).toThrow(/same record/)
  })

  test('does not cascade-delete a remotely added child when a member is removed locally', () => {
    const local = stateToRows(removeMember(createSeedState(), base.members[0].id).state, GUILD)
    const remote = {
      ...base,
      characters: [...base.characters, { ...base.characters[0], id: 'new-remote-character' }],
    }
    expect(() => mergeRows(base, local, remote)).toThrow(/same record/)
  })
})
