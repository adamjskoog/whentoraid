import { slotWindow } from './grid.js'
import { DEFAULT_CHECKIN_DEADLINE } from './guild.js'
import { addInterval } from './intervals.js'
import { STATE_VERSION } from './model.js'
import { DEFAULT_DURATION_SLOTS, DEFAULT_TARGETS } from './setup.js'

export const SEED_WEEK = '2026-09-28'

const NAMES = [
  'Adam',
  'Briar',
  'Mira',
  'Theo',
  'Juniper',
  'Ash',
  'Finn',
  'Lyra',
  'Rowan',
  'Kit',
  'Orion',
  'Sage',
  'Wren',
  'Atlas',
  'Ember',
  'Nox',
  'Pip',
  'Rook',
  'Vale',
  'Zephyr',
  'Cleo',
  'Dusk',
  'Echo',
  'Flint',
]

const CHARACTER_NAMES = [
  'Stoneguard',
  'Moonbriar',
  'Lumina',
  'Sunwarden',
  'Stormsong',
  'Wildmend',
  'Frostbyte',
  'Hexweaver',
  'Arrowfall',
  'Nightstep',
  'Ironhowl',
  'Duskprayer',
  'Cinderveil',
  'Felwhisper',
  'Longshot',
  'Quietblade',
  'Rageborn',
  'Mindshade',
  'Snowspell',
  'Soulkeeper',
  'Hawkeye',
  'Backstab',
  'Thornhide',
  'Lightwell',
]

const ARCHETYPES = [
  ['Warrior', 'Protection', 'Tank'],
  ['Druid', 'Feral', 'Tank'],
  ['Priest', 'Holy', 'Healer'],
  ['Paladin', 'Holy', 'Healer'],
  ['Shaman', 'Restoration', 'Healer'],
  ['Druid', 'Restoration', 'Healer'],
  ['Mage', 'Frost', 'DPS'],
  ['Warlock', 'Destruction', 'DPS'],
  ['Hunter', 'Marksmanship', 'DPS'],
  ['Rogue', 'Combat', 'DPS'],
  ['Warrior', 'Fury', 'DPS'],
  ['Priest', 'Shadow', 'DPS'],
]

const GUILD = {
  name: 'The After Hours',
  timezone: 'America/Los_Angeles',
  dayStartHour: 12,
  slotsPerDay: 24,
  discordServerId: '',
  officerRoleIds: '',
}

// Sample evenings run from 5 pm, which is 10 half-hour slots after the noon grid start.
const EVENING_FIRST_SLOT = 10
const EVENING_SLOTS = 12

function archetypeFor(index) {
  if (index === 14) return ARCHETYPES[8]
  if (index === 15) return ARCHETYPES[9]
  return ARCHETYPES[index % ARCHETYPES.length]
}

function seedCharacters(index) {
  const [cls, spec, role] = archetypeFor(index)
  const main = {
    id: `c${index}a`,
    memberId: `m${index}`,
    name: CHARACTER_NAMES[index],
    class: cls,
    spec,
    role,
    realm: 'Whitemane',
    main: true,
  }
  if (index % 4 !== 0) return [main]
  const alt = {
    id: `c${index}b`,
    memberId: `m${index}`,
    name: `${CHARACTER_NAMES[index]}alt`,
    class: 'Druid',
    spec: 'Restoration',
    role: 'Healer',
    realm: 'Whitemane',
    main: false,
  }
  return [main, alt]
}

// Hand-tuned sample pattern: Friday is the strong night, Saturday is decent, other nights are patchy.
function isFreeInEvening(index, day, eveningSlot) {
  if (day === 4) return eveningSlot >= 3 && eveningSlot < 9
  if (day === 5) return eveningSlot >= (index > 19 ? 5 : 2) && eveningSlot < 10
  if (day === 2) return eveningSlot >= 4 && eveningSlot < 10 && index % 5 !== 0
  return eveningSlot >= 4 + (index % 3) && eveningSlot < 10 && (index + day) % 3 !== 0
}

function seedRanges(index) {
  let ranges = []
  for (let day = 0; day < 7; day++) {
    for (let slot = 0; slot < EVENING_SLOTS; slot++) {
      if (isFreeInEvening(index, day, slot)) {
        ranges = addInterval(ranges, slotWindow(SEED_WEEK, day, EVENING_FIRST_SLOT + slot, 1, GUILD))
      }
    }
  }
  return ranges
}

export function createSeedState() {
  const members = NAMES.map((name, i) => ({ id: `m${i}`, name, discordId: '' }))
  const checkins = Object.fromEntries(
    members.map((m, i) => [m.id, { checkedIn: true, ranges: seedRanges(i), declined: [] }]),
  )
  return {
    version: STATE_VERSION,
    currentWeek: SEED_WEEK,
    currentMemberId: 'm0',
    guild: { ...GUILD },
    settings: {
      targets: [...DEFAULT_TARGETS],
      durationSlots: DEFAULT_DURATION_SLOTS,
      checkinDeadline: { ...DEFAULT_CHECKIN_DEADLINE },
    },
    members,
    characters: NAMES.flatMap((_, i) => seedCharacters(i)),
    weeks: { [SEED_WEEK]: { checkins, plan: null } },
  }
}
