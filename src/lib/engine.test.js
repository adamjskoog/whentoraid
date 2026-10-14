import { describe, expect, test } from 'vitest'
import { availabilityState, backups, compose, conflicts, isAvailable } from './engine.js'

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

describe('composition rules and availability preferences', () => {
  const typed = (id, className, spec = 'Frost', main = true) => ({
    ...character(id, 'DPS', main),
    class: className,
    spec,
  })
  const utility = { id: 'control', name: 'Encounter control', eligible: [{ class: 'Mage', spec: 'Frost' }] }

  test('reserves a class allowance for a scarce role instead of filling it with damage', () => {
    const players = [
      person('damage', [typed('d', 'Druid')]),
      person('tank', [{ ...typed('t', 'Druid'), role: 'Tank' }]),
      person('other', [typed('o', 'Mage')]),
    ]
    const result = compose(players, SESSION, [1, 0, 1], { rules: { classLimits: { Druid: 1 } } })
    expect(result.team.map((entry) => entry.memberId)).toEqual(['tank', 'other'])
  })

  test('chooses a qualifying alt over a main to cover required utility', () => {
    const players = [person('flex', [typed('main', 'Mage', 'Fire'), typed('alt', 'Mage', 'Frost', false)])]
    const result = compose(players, SESSION, [0, 0, 1], { rules: { requiredUtilities: [utility] } })
    expect(result.team[0].characterId).toBe('alt')
    expect(result.issues).toEqual([])
    expect(result.utilityCount).toBe(1)
  })

  test('reports an unmet requirement and a locked class excess without discarding locks', () => {
    const players = [person('a', [typed('a', 'Mage', 'Fire')]), person('b', [typed('b', 'Mage', 'Fire')])]
    const locked = players.map((p) => ({ memberId: p.id, characterId: p.id, role: 'DPS' }))
    const result = compose(players, SESSION, [0, 0, 2], {
      locked,
      rules: { classLimits: { Mage: 1 }, requiredUtilities: [utility] },
    })
    expect(result.team).toEqual(locked)
    expect(result.issues.map((issue) => issue.code)).toEqual(['class-limit', 'missing-utility'])
  })

  test('makes mains and preferred availability configurable while fairness remains the default', () => {
    const rested = { ...person('rested', [typed('a', 'Mage', 'Frost', false)]), priority: 3 }
    const main = person('main', [typed('b', 'Mage')])
    const preferred = {
      ...person('preferred', [typed('c', 'Mage', 'Frost', false)]),
      preferredRanges: [SESSION],
    }
    const players = [rested, main, preferred]
    expect(compose(players, SESSION, [0, 0, 1]).team[0].memberId).toBe('rested')
    expect(compose(players, SESSION, [0, 0, 1], { rules: { priority: 'mains' } }).team[0].memberId).toBe(
      'main',
    )
    expect(compose(players, SESSION, [0, 0, 1], { rules: { priority: 'preferred' } }).team[0].memberId).toBe(
      'preferred',
    )
  })

  test('prefers firm players to tentative players and reports a conditional roster', () => {
    const tentative = {
      ...person('tentative', [typed('a', 'Mage')], []),
      tentativeRanges: [SESSION],
      priority: 99,
    }
    const firm = person('firm', [typed('b', 'Mage', 'Frost', false)])
    expect(compose([tentative, firm], SESSION, [0, 0, 1]).team[0].memberId).toBe('firm')
    expect(compose([tentative, firm], SESSION, [0, 0, 2])).toMatchObject({ firm: 1, tentative: 1 })
    expect(
      conflicts({ memberId: 'tentative', characterId: 'a', role: 'DPS' }, [tentative], SESSION),
    ).toContain('Tentative availability — confirm before publishing')
  })

  test('combines firm and tentative intervals but rejects commitments, gaps and absent check-ins', () => {
    const player = { ...person('a', [], [{ start: 0, end: 2 }]), tentativeRanges: [{ start: 2, end: 4 }] }
    expect(availabilityState(player, SESSION)).toBe('tentative')
    expect(isAvailable(player, SESSION)).toBe(true)
    expect(availabilityState({ ...player, checkedIn: false }, SESSION)).toBe('unavailable')
    expect(availabilityState({ ...player, commitments: [{ start: 3, end: 5 }] }, SESSION)).toBe('unavailable')
    expect(availabilityState({ ...player, tentativeRanges: [{ start: 3, end: 4 }] }, SESSION)).toBe(
      'unavailable',
    )
  })
})
