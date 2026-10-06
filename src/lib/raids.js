import { DURATION_OPTIONS, MAX_RAID_SIZE } from './constants.js'

export const DEFAULT_RAID_ID = 'raid-20'

/** Starting compositions are editable examples, not encounter requirements. */
export function defaultRaids(targets = [2, 4, 14], durationSlots = 6) {
  return [
    {
      id: 'raid-10-1',
      name: '10-player Raid 1',
      size: 10,
      targets: [2, 2, 6],
      durationSlots: Math.min(6, durationSlots),
    },
    {
      id: 'raid-10-2',
      name: '10-player Raid 2',
      size: 10,
      targets: [2, 2, 6],
      durationSlots: Math.min(6, durationSlots),
    },
    {
      id: DEFAULT_RAID_ID,
      name: '20-player Raid',
      size: targets.reduce((a, b) => a + b, 0),
      targets: [...targets],
      durationSlots,
    },
  ]
}

export function getRaid(state, raidId = state.currentRaidId) {
  return state.settings.raids.find((raid) => raid.id === raidId) ?? state.settings.raids[0]
}

export function setCurrentRaid(state, raidId) {
  return state.settings.raids.some((raid) => raid.id === raidId) ? { ...state, currentRaidId: raidId } : state
}

export function validateRaid(raid) {
  if (typeof raid.name !== 'string' || !raid.name.trim() || raid.name.trim().length > 60)
    return 'Raid name must be between 1 and 60 characters.'
  if (!Number.isInteger(raid.size) || raid.size < 1 || raid.size > MAX_RAID_SIZE)
    return `Raid size must be between 1 and ${MAX_RAID_SIZE}.`
  if (
    !Array.isArray(raid.targets) ||
    raid.targets.length !== 3 ||
    !raid.targets.every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_RAID_SIZE)
  )
    return `Role slots must be whole numbers from 0 to ${MAX_RAID_SIZE}.`
  if (raid.targets.reduce((sum, n) => sum + n, 0) !== raid.size)
    return `The composition must total ${raid.size} players.`
  if (!DURATION_OPTIONS.includes(raid.durationSlots)) return 'Choose a valid raid duration.'
  return null
}
