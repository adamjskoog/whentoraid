import { describe, expect, it } from 'vitest'
import {
  assignmentKey,
  localRaidResponses,
  responsesByMember,
  responseSummary,
  saveLocalRaidResponse,
} from './raid-services.js'

const memoryStorage = () => ({
  value: '{}',
  getItem() {
    return this.value
  },
  setItem(_key, value) {
    this.value = value
  },
})

const published = {
  publishedAt: 10,
  start: 1000,
  end: 2000,
  team: [
    { memberId: 'm1', characterId: 'c1', role: 'Tank' },
    { memberId: 'm2', characterId: 'c2', role: 'DPS' },
  ],
}

describe('raid responses', () => {
  it('an assignment is the player’s character, role and session time', () => {
    expect(assignmentKey(published, 'm1')).toBe('c1|Tank|1000|2000')
    expect(assignmentKey(published, 'nobody')).toBe(null)
  })

  it('keeps local responses isolated by guild, raid and player', () => {
    const storage = memoryStorage()
    saveLocalRaidResponse('one', '2026-10-12', 'raid-a', 'm1', published, 'confirmed', '', storage)
    expect(localRaidResponses('one', '2026-10-12', 'raid-a', storage)).toHaveLength(1)
    expect(localRaidResponses('two', '2026-10-12', 'raid-a', storage)).toEqual([])
    expect(localRaidResponses('one', '2026-10-12', 'raid-b', storage)).toEqual([])
  })

  it('rejects unrostered players, unknown statuses and overlong notes', () => {
    const storage = memoryStorage()
    const save = (memberId, status, note = '') =>
      saveLocalRaidResponse('one', '2026-10-12', 'raid-a', memberId, published, status, note, storage)
    expect(() => save('nobody', 'confirmed')).toThrow('Only rostered players')
    expect(() => save('m1', 'bogus')).toThrow()
    expect(() => save('m1', 'unavailable', 'x'.repeat(501))).toThrow()
  })

  it('a later response replaces the player’s earlier one', () => {
    const storage = memoryStorage()
    saveLocalRaidResponse('one', '2026-10-12', 'raid-a', 'm1', published, 'confirmed', '', storage)
    saveLocalRaidResponse('one', '2026-10-12', 'raid-a', 'm1', published, 'unavailable', ' Sick ', storage)
    const [only] = localRaidResponses('one', '2026-10-12', 'raid-a', storage)
    expect(only).toMatchObject({ member_id: 'm1', status: 'unavailable', note: 'Sick', publication: '10' })
  })

  it('a response survives republishing while that player’s assignment is unchanged', () => {
    const storage = memoryStorage()
    saveLocalRaidResponse('one', '2026-10-12', 'raid-a', 'm1', published, 'confirmed', '', storage)
    saveLocalRaidResponse('one', '2026-10-12', 'raid-a', 'm2', published, 'confirmed', '', storage)
    const rows = localRaidResponses('one', '2026-10-12', 'raid-a', storage)
    // m2 moves to a different character; m1 is untouched.
    const swapped = {
      ...published,
      publishedAt: 20,
      team: [published.team[0], { memberId: 'm2', characterId: 'c3', role: 'DPS' }],
    }
    expect(Object.keys(responsesByMember(rows, swapped))).toEqual(['m1'])
    // A new time asks everyone again.
    expect(responsesByMember(rows, { ...published, publishedAt: 30, start: 1500, end: 2500 })).toEqual({})
  })

  it('sorts every rostered player into confirmed, unavailable or waiting', () => {
    const team = [{ memberId: 'm1' }, { memberId: 'm2' }, { memberId: 'm3' }]
    const summary = responseSummary(team, { m1: { status: 'confirmed' }, m2: { status: 'unavailable' } })
    expect(summary.confirmed.map((e) => e.memberId)).toEqual(['m1'])
    expect(summary.unavailable.map((e) => e.memberId)).toEqual(['m2'])
    expect(summary.waiting.map((e) => e.memberId)).toEqual(['m3'])
  })
})
