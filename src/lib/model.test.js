import { describe, expect, test } from 'vitest'
import { slotWindow } from './grid.js'
import {
  charactersOf,
  deleteCharacter,
  enginePlayers,
  getCheckin,
  getWeek,
  preferredCharacter,
  pruneOldWeeks,
  setMainCharacter,
  setPlan,
  isOfferingAny,
  markUnavailable,
  saveCharacter,
  saveSettings,
  setCharacterOffered,
  setCurrentWeek,
  setSlotAvailable,
} from './model.js'
import { createSeedState, SEED_WEEK } from './seed.js'

const validCharacter = { name: 'Newblade', realm: 'Whitemane', class: 'Rogue', spec: 'Combat', role: 'DPS' }

describe('seed data', () => {
  test('creates 24 checked-in members with six alts', () => {
    const state = createSeedState()
    expect(state.members).toHaveLength(24)
    expect(state.characters).toHaveLength(30)
    expect(state.members.every((m) => getCheckin(state, SEED_WEEK, m.id).checkedIn)).toBe(true)
  })
})

describe('saveCharacter', () => {
  test('editing replaces the character in place (regression: edit used to add a duplicate)', () => {
    const state = createSeedState()
    const { state: next, error } = saveCharacter(state, 'm0', {
      ...validCharacter,
      id: 'c0a',
      name: 'Renamed',
    })
    expect(error).toBeUndefined()
    expect(next.characters).toHaveLength(state.characters.length)
    expect(next.characters.find((c) => c.id === 'c0a')).toMatchObject({
      name: 'Renamed',
      main: true,
      memberId: 'm0',
    })
  })

  test('adding creates a new alt with a fresh id', () => {
    const state = createSeedState()
    const { state: next } = saveCharacter(state, 'm0', validCharacter, () => 'new-id')
    expect(charactersOf(next, 'm0').map((c) => c.id)).toEqual(['c0a', 'c0b', 'new-id'])
    expect(next.characters.at(-1)).toMatchObject({ main: false, name: 'Newblade' })
  })

  test("cannot edit another member's character", () => {
    const state = createSeedState()
    const { state: next } = saveCharacter(state, 'm0', { ...validCharacter, id: 'c1a' }, () => 'new-id')
    expect(next.characters.find((c) => c.id === 'c1a').name).toBe('Moonbriar')
    expect(next.characters.at(-1).id).toBe('new-id')
  })

  test('rejects blank or invalid fields without changing state', () => {
    const state = createSeedState()
    expect(saveCharacter(state, 'm0', { ...validCharacter, name: '   ' })).toEqual({
      state,
      error: 'Name is required.',
    })
    expect(saveCharacter(state, 'm0', { ...validCharacter, class: 'Paladine' }).error).toBe(
      'Choose a valid class.',
    )
    expect(saveCharacter(state, 'm0', { ...validCharacter, role: 'Bard' }).error).toBe(
      'Choose a valid raid role.',
    )
  })
})

describe('character management', () => {
  test("setMainCharacter makes one main and the member's others alts, leaving other members alone", () => {
    const state = setMainCharacter(createSeedState(), 'm0', 'c0b')
    expect(charactersOf(state, 'm0').map((c) => [c.id, c.main])).toEqual([
      ['c0a', false],
      ['c0b', true],
    ])
    expect(charactersOf(state, 'm1')[0].main).toBe(true)
    expect(setMainCharacter(state, 'm0', 'c1a')).toBe(state)
  })

  test('deleteCharacter removes the character and its roster entry, locks, and declines', () => {
    let state = createSeedState()
    state = setCharacterOffered(state, SEED_WEEK, 'm0', 'c0b', false)
    const team = [
      { memberId: 'm0', characterId: 'c0b', role: 'Healer' },
      { memberId: 'm1', characterId: 'c1a', role: 'Tank' },
    ]
    state = setPlan(state, SEED_WEEK, { start: 0, team, locked: ['m0', 'm1'] })

    const { state: next, error } = deleteCharacter(state, 'm0', 'c0b')
    expect(error).toBeUndefined()
    expect(charactersOf(next, 'm0').map((c) => c.id)).toEqual(['c0a'])
    expect(getWeek(next, SEED_WEEK).plan).toMatchObject({ team: [team[1]], locked: ['m1'] })
    expect(getCheckin(next, SEED_WEEK, 'm0').declined).toEqual([])
  })

  test('deleting the main promotes the next character', () => {
    const { state } = deleteCharacter(createSeedState(), 'm0', 'c0a')
    expect(charactersOf(state, 'm0')).toMatchObject([{ id: 'c0b', main: true }])
  })

  test("refuses to delete a member's only character or someone else's", () => {
    const state = createSeedState()
    expect(deleteCharacter(state, 'm1', 'c1a').error).toMatch(/at least one character/)
    expect(deleteCharacter(state, 'm0', 'c1a')).toEqual({ state, error: 'Character not found.' })
  })

  test('preferredCharacter picks the offered main, then any offered, then the main', () => {
    let state = createSeedState()
    expect(preferredCharacter(state, SEED_WEEK, 'm0').id).toBe('c0a')
    state = setCharacterOffered(state, SEED_WEEK, 'm0', 'c0a', false)
    expect(preferredCharacter(state, SEED_WEEK, 'm0').id).toBe('c0b')
    state = setCharacterOffered(state, SEED_WEEK, 'm0', 'c0b', false)
    expect(preferredCharacter(state, SEED_WEEK, 'm0').id).toBe('c0a')
  })
})

describe('weekly check-ins', () => {
  test('editing availability keeps the member counted (regression: edits used to drop them to a draft)', () => {
    const state = createSeedState()
    const interval = slotWindow(SEED_WEEK, 0, 0, 1, state.guild)
    const next = setSlotAvailable(state, SEED_WEEK, 'm0', interval, true)
    const checkin = getCheckin(next, SEED_WEEK, 'm0')
    expect(checkin.checkedIn).toBe(true)
    expect(checkin.ranges).toContainEqual(interval)
    expect(enginePlayers(next, SEED_WEEK).find((p) => p.id === 'm0').checkedIn).toBe(true)
  })

  test('the first edit of a new week checks the member in', () => {
    const state = setCurrentWeek(createSeedState(), '2026-10-05')
    expect(getCheckin(state, '2026-10-05', 'm0').checkedIn).toBe(false)
    const interval = slotWindow('2026-10-05', 4, 12, 1, state.guild)
    expect(
      getCheckin(setSlotAvailable(state, '2026-10-05', 'm0', interval, true), '2026-10-05', 'm0').checkedIn,
    ).toBe(true)
    expect(
      getCheckin(setCharacterOffered(state, '2026-10-05', 'm0', 'c0b', false), '2026-10-05', 'm0').checkedIn,
    ).toBe(true)
  })

  test('"can\'t make it" clears availability but still counts as a response', () => {
    const state = markUnavailable(createSeedState(), SEED_WEEK, 'm0')
    expect(getCheckin(state, SEED_WEEK, 'm0')).toMatchObject({ checkedIn: true, ranges: [] })
  })

  test('isOfferingAny is false only when every character is declined', () => {
    let state = createSeedState()
    state = setCharacterOffered(state, SEED_WEEK, 'm0', 'c0a', false)
    expect(isOfferingAny(state, SEED_WEEK, 'm0')).toBe(true)
    state = setCharacterOffered(state, SEED_WEEK, 'm0', 'c0b', false)
    expect(isOfferingAny(state, SEED_WEEK, 'm0')).toBe(false)
    state = setCharacterOffered(state, SEED_WEEK, 'm0', 'c0b', true)
    expect(isOfferingAny(state, SEED_WEEK, 'm0')).toBe(true)
  })

  test('a new week starts with nobody checked in', () => {
    const state = setCurrentWeek(createSeedState(), '2026-10-07')
    expect(state.currentWeek).toBe('2026-10-05')
    expect(getCheckin(state, state.currentWeek, 'm0')).toEqual({ checkedIn: false, ranges: [], declined: [] })
  })

  test('an invalid week date is ignored', () => {
    const state = createSeedState()
    expect(setCurrentWeek(state, 'not-a-date')).toBe(state)
  })
})

describe('saveSettings', () => {
  const base = { targets: [2, 4, 14], durationSlots: 6, discordServerId: '', officerRoleIds: '' }

  test('accepts valid settings', () => {
    const { state, error } = saveSettings(createSeedState(), {
      ...base,
      targets: [1, 2, 7],
      raidSize: 10,
      discordServerId: '123',
    })
    expect(error).toBeUndefined()
    expect(state.settings.raids.find((raid) => raid.id === state.currentRaidId).targets).toEqual([1, 2, 7])
    expect(state.guild.discordServerId).toBe('123')
  })

  test('rejects out-of-range raid sizes and bad IDs', () => {
    const state = createSeedState()
    expect(saveSettings(state, { ...base, targets: [0, 0, 0] }).error).toMatch(/between 1 and 40/)
    expect(saveSettings(state, { ...base, targets: [20, 20, 1] }).error).toMatch(/between 1 and 40/)
    expect(saveSettings(state, { ...base, targets: [1.5, 2, 3] }).error).toMatch(/whole numbers/)
    expect(saveSettings(state, { ...base, durationSlots: 9 }).error).toMatch(/duration/)
    expect(saveSettings(state, { ...base, discordServerId: 'abc' }).error).toMatch(/digits/)
  })
})

describe('pruneOldWeeks', () => {
  const RANGE = { start: 1000, end: 2000 }
  const checkins = { m0: { checkedIn: true, ranges: [RANGE], declined: [] } }
  const plan = { start: 1000, team: [], locked: [], attendance: { m0: 'attended' }, cancelled: false }

  function withWeeks(weeks) {
    return { ...createSeedState(), weeks }
  }

  test('drops old check-ins but keeps old plans for attendance records', () => {
    const state = withWeeks({
      '2026-01-05': { checkins, plans: { 'raid-20': plan } },
      '2026-01-12': { checkins, plans: {} },
      '2026-09-28': { checkins, plans: {} },
    })
    const pruned = pruneOldWeeks(state, '2026-09-28', 12)
    expect(pruned.weeks).toEqual({
      '2026-01-05': { checkins: {}, plans: { 'raid-20': plan } },
      '2026-09-28': { checkins, plans: {} },
    })
  })

  test('keeps weeks inside the history window whole', () => {
    const state = withWeeks({ '2026-07-06': { checkins, plans: {} } })
    expect(pruneOldWeeks(state, '2026-09-28', 12)).toBe(state)
  })

  test('returns the same state when nothing is old enough', () => {
    const state = createSeedState()
    expect(pruneOldWeeks(state, SEED_WEEK)).toBe(state)
  })
})
