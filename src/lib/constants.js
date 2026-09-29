export const ROLES = ['Tank', 'Healer', 'DPS']

export const ROLE_ICONS = { Tank: '◈', Healer: '✧', DPS: '⚔' }

export const CLASS_COLORS = {
  Warrior: '#c69b6d',
  Paladin: '#f48cba',
  Hunter: '#aad372',
  Rogue: '#fff468',
  Priest: '#e5e5e5',
  Shaman: '#4999ef',
  Mage: '#69ccf0',
  Warlock: '#a88cdd',
  Druid: '#ff9945',
}

export const CLASS_NAMES = Object.keys(CLASS_COLORS)

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const SLOT_MINUTES = 30

export const MAX_RAID_SIZE = 40

/** Raid lengths offered in settings, in 30-minute slots (1 to 4 hours). */
export const DURATION_OPTIONS = [2, 3, 4, 5, 6, 7, 8]

export const TOAST_MS = 3500

/** Toasts with an Undo button stay longer, so there is time to reach it. */
export const UNDO_TOAST_MS = 8000
