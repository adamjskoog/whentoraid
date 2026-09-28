import { describe, expect, test } from 'vitest'
import { backups, compose, conflicts, isAvailable } from './engine.js'

const SESSION = { start: 0, end: 4 }
const character = (id, role, main = true, offered = true) => ({ id, role, main, offered })
const person = (id, characters, ranges = [{ start: 0, end: 4 }]) => ({
  id,
  characters,
  ranges,
  checkedIn: true,
})

describe('compose', () => {
  test('one player with multiple alts never fills multiple slots', () => {
    const players = [person('p1', [character('a', 'Tank'), character('b', 'Healer')])]
    expect(compose(players, SESSION, [1, 1, 0]).team).toHaveLength(1)
  })

  test('assigns a flexible player to the role needed for a complete team', () => {
    const players = [
      person('p1', [character('a', 'Tank'), character('b', 'Healer', false)]),
      person('p2', [character('c', 'Tank')]),
    ]
    const { team } = compose(players, SESSION, [1, 1, 0])
    expect(team).toHaveLength(2)
    expect(team.find((e) => e.memberId === 'p1').characterId).toBe('b')
  })

  test('excludes partial attendance, members not checked in, and unoffered characters', () => {
    const players = [
      person('p1', [character('a', 'Tank')], [{ start: 0, end: 3 }]),
      { ...person('p2', [character('b', 'Tank')]), checkedIn: false },
      person('p3', [character('c', 'Tank', true, false)]),
    ]
    expect(compose(players, SESSION, [1, 0, 0]).team).toHaveLength(0)
  })

  test('prefers the main character and keeps role counts within caps', () => {
    const players = [
      person('p1', [character('a', 'DPS', false), character('b', 'DPS')]),
      person('p2', [character('c', 'DPS')]),
    ]
    const result = compose(players, SESSION, [0, 0, 1])
    expect(result.team).toHaveLength(1)
    expect(result.mains).toBe(1)
  })

  test('on a tie, the player who sat out recently is picked over list order', () => {
    const players = [
      person('first', [character('a', 'DPS')]),
      { ...person('rested', [character('b', 'DPS')]), priority: 2 },
    ]
    expect(compose(players, SESSION, [0, 0, 1]).team.map((e) => e.memberId)).toEqual(['rested'])
  })

  test('fairness never costs a filled slot', () => {
    const players = [
      { ...person('dpsOnly', [character('a', 'DPS')]), priority: 3 },
      person('flex', [character('b', 'Tank'), character('c', 'DPS', false)]),
    ]
    const { team } = compose(players, SESSION, [1, 0, 1])
    expect(team).toHaveLength(2)
    expect(team.find((e) => e.memberId === 'flex').role).toBe('Tank')
  })

  test('fairness picks the person; main preference still picks their character', () => {
    const players = [
      person('first', [character('a', 'DPS')]),
      { ...person('rested', [character('alt', 'DPS', false), character('main', 'DPS')]), priority: 1 },
    ]
    expect(compose(players, SESSION, [0, 0, 1]).team).toEqual([
      { memberId: 'rested', characterId: 'main', role: 'DPS' },
    ])
  })
})

describe('compose with locked entries', () => {
  test('locked entries are kept as-is, fill their slots, and are not placed twice', () => {
    const players = [
      person('p1', [character('a', 'Tank')]),
      person('p2', [character('b', 'Tank')]),
      person('p3', [character('c', 'DPS')]),
    ]
    const locked = [{ memberId: 'p2', characterId: 'b', role: 'Tank' }]
    const { team } = compose(players, SESSION, [1, 0, 1], { locked })
    expect(team).toEqual([locked[0], { memberId: 'p3', characterId: 'c', role: 'DPS' }])
  })

  test('a locked player is kept even when unavailable or off-role', () => {
    const away = person('away', [character('a', 'DPS')], [])
    const locked = [{ memberId: 'away', characterId: 'a', role: 'Tank' }]
    expect(compose([away], SESSION, [1, 0, 0], { locked }).team).toEqual(locked)
  })
})

describe('backups', () => {
  test('counts spare available players per role, including flexible players in each role', () => {
    const players = [
      person('rostered', [character('a', 'Tank')]),
      person('flex', [character('b', 'Tank'), character('c', 'Healer')]),
      person('dps', [character('d', 'DPS')]),
      person('away', [character('e', 'DPS')], []),
      person('declined', [character('f', 'Healer', true, false)]),
    ]
    const team = [{ memberId: 'rostered', characterId: 'a', role: 'Tank' }]
    expect(backups(players, SESSION, team)).toEqual([1, 1, 1])
  })

  test('an empty guild produces an empty roster', () => {
    expect(compose([], SESSION, [2, 4, 14]).team).toEqual([])
  })
})

describe('isAvailable', () => {
  test('requires one continuous range covering the whole session', () => {
    const split = person(
      'p1',
      [],
      [
        { start: 0, end: 2 },
        { start: 2, end: 4 },
      ],
    )
    const gap = person(
      'p2',
      [],
      [
        { start: 0, end: 2 },
        { start: 3, end: 4 },
      ],
    )
    expect(isAvailable(split, SESSION)).toBe(true)
    expect(isAvailable(gap, SESSION)).toBe(false)
  })

  test('rejects empty or reversed sessions', () => {
    expect(isAvailable(person('p1', []), { start: 2, end: 2 })).toBe(false)
  })
})

describe('conflicts', () => {
  test('reports attendance, willingness, and role problems for manual overrides', () => {
    const p = person('p1', [character('a', 'DPS', true, false)], [{ start: 0, end: 1 }])
    expect(conflicts({ memberId: 'p1', characterId: 'a', role: 'Tank' }, [p], SESSION)).toEqual([
      'Unavailable for full session',
      'Character not offered',
      'Role mismatch',
    ])
  })

  test('reports a missing character', () => {
    expect(conflicts({ memberId: 'nobody', characterId: 'x', role: 'Tank' }, [], SESSION)).toEqual([
      'Character missing',
    ])
  })
})
