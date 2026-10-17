/** Wowhead's image CDN; `medium` icons are 36×36 JPEGs. Not cached offline (the service worker is same-origin only). */
const ICON_BASE = 'https://wow.zamimg.com/images/wow/icons/medium/'

/** Classic Era talent-tree icons, keyed like SPEC_ROLES in constants.js. */
export const SPEC_ICONS = {
  Warrior: {
    Arms: 'ability_warrior_savageblow',
    Fury: 'ability_warrior_innerrage',
    Protection: 'ability_warrior_defensivestance',
  },
  Paladin: {
    Holy: 'spell_holy_holybolt',
    Protection: 'spell_holy_devotionaura',
    Retribution: 'spell_holy_auraoflight',
  },
  Hunter: {
    'Beast Mastery': 'ability_hunter_beasttaming',
    Marksmanship: 'ability_marksmanship',
    Survival: 'ability_hunter_swiftstrike',
  },
  Rogue: {
    Assassination: 'ability_rogue_eviscerate',
    Combat: 'ability_backstab',
    Subtlety: 'ability_stealth',
  },
  Priest: {
    Discipline: 'spell_holy_wordfortitude',
    Holy: 'spell_holy_holybolt',
    Shadow: 'spell_shadow_shadowwordpain',
  },
  Shaman: {
    Elemental: 'spell_nature_lightning',
    Enhancement: 'spell_nature_lightningshield',
    Restoration: 'spell_nature_magicimmunity',
  },
  Mage: {
    Arcane: 'spell_holy_magicalsentry',
    Fire: 'spell_fire_flamebolt',
    Frost: 'spell_frost_frostbolt02',
  },
  Warlock: {
    Affliction: 'spell_shadow_deathcoil',
    Demonology: 'spell_shadow_metamorphosis',
    Destruction: 'spell_shadow_rainoffire',
  },
  Druid: {
    Balance: 'spell_nature_starfall',
    'Feral Combat': 'ability_racial_bearform',
    Restoration: 'spell_nature_healingtouch',
  },
}

/** Icon URL for a class's spec, or null for a spec outside the Classic list (e.g. typed before the dropdown). */
export function specIconUrl(characterClass, spec) {
  const icon = Object.hasOwn(SPEC_ICONS, characterClass) ? SPEC_ICONS[characterClass][spec] : undefined
  return typeof icon === 'string' ? `${ICON_BASE}${icon}.jpg` : null
}

/** Stable application emoji names, independent of a particular server's custom emojis. */
export function specEmojiName(characterClass, spec) {
  if (!specIconUrl(characterClass, spec)) return null
  return `wtr_${characterClass}_${spec}`.toLowerCase().replaceAll(' ', '_')
}
