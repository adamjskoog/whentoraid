import { describe, expect, test } from 'vitest'
import { SPEC_ROLES } from './constants.js'
import { specIconUrl } from './spec-icons.js'

describe('specIconUrl', () => {
  test('every Classic spec has an icon on the Wowhead image CDN', () => {
    for (const [characterClass, specs] of Object.entries(SPEC_ROLES)) {
      for (const spec of Object.keys(specs)) {
        expect(specIconUrl(characterClass, spec)).toMatch(
          /^https:\/\/wow\.zamimg\.com\/images\/wow\/icons\/medium\/[a-z0-9_]+\.jpg$/,
        )
      }
    }
  })

  test('the same spec name gets each class’s own icon', () => {
    expect(specIconUrl('Warrior', 'Protection')).toContain('ability_warrior_defensivestance')
    expect(specIconUrl('Paladin', 'Protection')).toContain('spell_holy_devotionaura')
  })

  test('a spec typed before the dropdown existed has no icon', () => {
    expect(specIconUrl('Warrior', 'Deep Prot')).toBeNull()
    expect(specIconUrl('Monk', 'Brewmaster')).toBeNull()
  })
})
