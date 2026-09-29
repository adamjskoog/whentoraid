import { describe, expect, test } from 'vitest'
import { addMember, removeMember, setCurrentMember, updateMember, validateMember } from './members.js'
import { charactersOf, getWeek, setPlan } from './model.js'
import { createSeedState, SEED_WEEK } from './seed.js'

const MAIN = { name: 'Newblade', realm: 'Whitemane', class: 'Rogue', spec: 'Combat', role: 'DPS' }
const DISCORD_ID = '123456789012345678'

function ids(...values) {
  let i = 0
  return () => values[i++]
}

describe('validateMember', () => {
  const state = createSeedState()

  test('trims names and accepts a blank or snowflake Discord ID', () => {
    expect(validateMember(state, { name: '  Nova ', discordId: '' })).toEqual({
      value: { name: 'Nova', discordId: '' },
    })
    expect(validateMember(state, { name: 'Nova', discordId: DISCORD_ID }).value.discordId).toBe(DISCORD_ID)
  })

  test('rejects blank, too long, duplicate (any case), and malformed Discord IDs', () => {
    expect(validateMember(state, { name: '  ' }).error).toMatch(/required/)
    expect(validateMember(state, { name: 'x'.repeat(31) }).error).toMatch(/30 characters/)
    expect(validateMember(state, { name: 'briar' }).error).toMatch(/already in the guild/)
    expect(validateMember(state, { name: 'Nova', discordId: '12345' }).error).toMatch(/17–20 digits/)
    expect(validateMember(state, { name: 'Nova', discordId: '@nova' }).error).toMatch(/17–20 digits/)
  })

  test("a member's own name is not a duplicate when editing them", () => {
    expect(validateMember(state, { name: 'Briar' }, 'm1').value.name).toBe('Briar')
  })
})

describe('addMember', () => {
  test('adds the member with a main character', () => {
    const { state, memberId, error } = addMember(
      createSeedState(),
      { name: 'Nova', discordId: DISCORD_ID },
      MAIN,
      ids('m-new', 'c-new'),
    )
    expect(error).toBeUndefined()
    expect(memberId).toBe('m-new')
    expect(state.members.at(-1)).toEqual({ id: 'm-new', name: 'Nova', discordId: DISCORD_ID })
    expect(charactersOf(state, 'm-new')).toEqual([{ id: 'c-new', memberId: 'm-new', main: true, ...MAIN }])
  })

  test('an invalid member or character changes nothing', () => {
    const initial = createSeedState()
    expect(addMember(initial, { name: '' }, MAIN).state).toBe(initial)
    expect(addMember(initial, { name: 'Nova' }, { ...MAIN, class: 'Bard' }).error).toMatch(/valid class/)
    expect(addMember(initial, { name: 'Nova' }, { ...MAIN, class: 'Bard' }).state).toBe(initial)
  })
})

describe('updateMember', () => {
  test('renames and sets the Discord ID', () => {
    const { state } = updateMember(createSeedState(), 'm1', { name: 'Briar Rose', discordId: DISCORD_ID })
    expect(state.members[1]).toEqual({ id: 'm1', name: 'Briar Rose', discordId: DISCORD_ID })
  })

  test('unknown members and invalid input are errors', () => {
    const initial = createSeedState()
    expect(updateMember(initial, 'nobody', { name: 'X' }).error).toMatch(/not found/)
    expect(updateMember(initial, 'm1', { name: 'Adam' }).error).toMatch(/already/)
  })
})

describe('removeMember', () => {
  test('removes characters, check-ins, and every roster reference', () => {
    const team = [
      { memberId: 'm1', characterId: 'c1a', role: 'Tank' },
      { memberId: 'm2', characterId: 'c2a', role: 'Healer' },
    ]
    const planned = setPlan(createSeedState(), SEED_WEEK, {
      start: 0,
      team,
      locked: ['m1', 'm2'],
      attendance: { m1: 'attended', m2: 'late' },
    })
    const { state, error } = removeMember(planned, 'm1')
    expect(error).toBeUndefined()
    expect(state.members.some((m) => m.id === 'm1')).toBe(false)
    expect(charactersOf(state, 'm1')).toEqual([])
    const week = getWeek(state, SEED_WEEK)
    expect('m1' in week.checkins).toBe(false)
    expect(week.plan.team).toEqual([team[1]])
    expect(week.plan.locked).toEqual(['m2'])
    expect(week.plan.attendance).toEqual({ m2: 'late' })
  })

  test('removing yourself switches to the first remaining member', () => {
    const { state } = removeMember(createSeedState(), 'm0')
    expect(state.currentMemberId).toBe('m1')
  })

  test('the last member stays', () => {
    let state = createSeedState()
    state = { ...state, members: [state.members[0]] }
    expect(removeMember(state, 'm0').error).toMatch(/at least one player/)
  })
})

describe('setCurrentMember', () => {
  test('switches to a known member and ignores unknown IDs', () => {
    const initial = createSeedState()
    expect(setCurrentMember(initial, 'm3').currentMemberId).toBe('m3')
    expect(setCurrentMember(initial, 'nobody')).toBe(initial)
  })
})
