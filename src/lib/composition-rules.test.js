import { describe, expect, test } from 'vitest'
import {
  compositionIssues,
  normalizeCompositionRules,
  raidRules,
  saveRaidRules,
  validateCompositionRules,
} from './composition-rules.js'
import { createSeedState } from './seed.js'
import { parseState } from './storage.js'

describe('composition rules', () => {
  test('normalizes missing optional settings without sharing mutable defaults', () => {
    expect(normalizeCompositionRules()).toEqual({
      classLimits: {},
      requiredUtilities: [],
      priority: 'fairness',
    })
    const rules = normalizeCompositionRules()
    rules.classLimits.Mage = 1
    expect(normalizeCompositionRules().classLimits).toEqual({})
  })

  test('validates bounds, known class/spec combinations, duplicate identifiers and priorities', () => {
    const valid = { id: 'control', name: 'Control', eligible: [{ class: 'Mage', spec: 'Frost' }] }
    expect(validateCompositionRules({ requiredUtilities: [valid], classLimits: { Mage: 0 } })).toBeNull()
    for (const rules of [
      { classLimits: { Mage: 41 } },
      { classLimits: { Mage: -1 } },
      { classLimits: { unknown: 1 } },
      { requiredUtilities: [{ ...valid, eligible: [] }] },
      { requiredUtilities: [{ ...valid, eligible: [{ class: 'Mage', spec: 'Holy' }] }] },
      { requiredUtilities: [valid, valid] },
      { priority: 'gear' },
    ])
      expect(validateCompositionRules(rules)).toEqual(expect.any(String))
  })

  test('explains which qualifying class or specialization is missing', () => {
    const rules = {
      requiredUtilities: [{ id: 'control', name: 'Control', eligible: [{ class: 'Mage', spec: 'Frost' }] }],
    }
    const issues = compositionIssues([], [], rules)
    expect(issues[0]).toMatchObject({ code: 'missing-utility', utilityId: 'control' })
    expect(issues[0].message).toContain('Control')
    expect(issues[0].message).toContain('Frost Mage')
  })
})

describe('saving raid rules', () => {
  const rules = {
    classLimits: { Mage: 2 },
    requiredUtilities: [{ id: 'control', name: ' Control ', eligible: [{ class: 'Mage', spec: 'Frost' }] }],
    priority: 'mains',
  }

  test('stores trimmed rules on one raid only and survives a backup', () => {
    const state = createSeedState()
    const { state: saved, error } = saveRaidRules(state, 'raid-20', rules)
    expect(error).toBeUndefined()
    expect(raidRules(saved.settings.raids.find((r) => r.id === 'raid-20')).requiredUtilities[0].name).toBe(
      'Control',
    )
    expect(saved.settings.raids.find((r) => r.id === 'raid-10-1').rules).toBeUndefined()
    expect(state.settings.raids.find((r) => r.id === 'raid-20').rules).toBeUndefined()
    expect(parseState(JSON.stringify(saved))).toEqual(saved)
  })

  test('removes rules that change nothing and refuses invalid ones', () => {
    const state = saveRaidRules(createSeedState(), 'raid-20', rules).state
    const cleared = saveRaidRules(state, 'raid-20', {}).state
    expect('rules' in cleared.settings.raids.find((r) => r.id === 'raid-20')).toBe(false)
    expect(saveRaidRules(state, 'raid-20', { priority: 'gear' }).error).toBeTruthy()
    expect(saveRaidRules(state, 'missing', rules).error).toBeTruthy()
  })

  test('a backup with malformed rules is refused', () => {
    const state = createSeedState()
    state.settings.raids[0].rules = { classLimits: { Mage: -1 } }
    expect(parseState(JSON.stringify(state))).toBeNull()
  })
})
