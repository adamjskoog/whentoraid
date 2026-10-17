import { describe, expect, it } from 'vitest'
import { damageType, displayRoles } from '../../supabase/functions/_shared/raid-presentation.js'
import { signupLineup } from '../../supabase/functions/_shared/signup-lineup.js'

describe('Discord damage groups', () => {
  it.each([
    ['Warrior', 'Fury', 'Melee'],
    ['Paladin', 'Retribution', 'Melee'],
    ['Rogue', 'Combat', 'Melee'],
    ['Hunter', 'Survival', 'Ranged'],
    ['Priest', 'Shadow', 'Ranged'],
    ['Mage', 'Frost', 'Ranged'],
    ['Warlock', 'Affliction', 'Ranged'],
    ['Shaman', 'Enhancement', 'Melee'],
    ['Shaman', 'Elemental', 'Ranged'],
    ['Druid', 'Feral Combat', 'Melee'],
    ['Druid', 'Balance', 'Ranged'],
    ['Druid', '', 'Unknown'],
    ['Shaman', 'Restoration', 'Unknown'],
    ['Shaman', 'constructor', 'Unknown'],
    ['Unknown', '', 'Unknown'],
  ])('classifies %s %s as %s', (characterClass, spec, expected) => {
    expect(damageType({ class: characterClass, spec, role: 'DPS' })).toBe(expected)
    expect(damageType({ class: characterClass, spec, role: 'Tank' })).toBeNull()
    expect(damageType({ class: characterClass, spec, role: 'Healer' })).toBeNull()
  })

  it('shares the DPS cap across melee and ranged and preserves bench order', () => {
    const signups = [
      { name: 'Melee', class: 'Rogue', spec: 'Combat', role: 'DPS', status: 'signed' },
      { name: 'Ranged', class: 'Mage', spec: 'Frost', role: 'DPS', status: 'late' },
      { name: 'Benched', class: 'Priest', spec: 'Shadow', role: 'DPS', status: 'signed' },
      { name: 'Unsure', class: 'Druid', role: 'DPS', status: 'tentative' },
    ]
    const lineup = signupLineup(signups, [1, 1, 2])
    const groups = displayRoles(lineup.roles)
    expect(groups.map(({ role, members }) => [role, members.map(({ name }) => name)])).toEqual([
      ['Tank', []],
      ['Healer', []],
      ['Melee', ['Melee']],
      ['Ranged', ['Ranged']],
    ])
    expect(lineup.bench.map(({ name }) => name)).toEqual(['Benched'])
    expect(lineup.tentative.map(({ name }) => name)).toEqual(['Unsure'])
  })
})
