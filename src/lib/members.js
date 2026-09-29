import { planWithout, validateCharacter } from './model.js'

export const MEMBER_NAME_MAX = 30

/** Discord user IDs are 17–20 digit snowflakes. Blank means "not known yet". */
const DISCORD_USER_ID = /^(\d{17,20})?$/

/**
 * @param {{ name: string, discordId?: string }} input
 * @param {string | null} memberId the member being edited, so their own name does not count as taken
 * @returns {{ value: { name: string, discordId: string } } | { error: string }}
 */
export function validateMember(state, input, memberId = null) {
  const name = String(input.name ?? '').trim()
  if (!name) return { error: 'Player name is required.' }
  if (name.length > MEMBER_NAME_MAX)
    return { error: `Player name must be ${MEMBER_NAME_MAX} characters or fewer.` }

  const taken = state.members.some((m) => m.id !== memberId && m.name.toLowerCase() === name.toLowerCase())
  if (taken) return { error: `${name} is already in the guild.` }

  const discordId = String(input.discordId ?? '').trim()
  if (!DISCORD_USER_ID.test(discordId)) {
    return {
      error:
        'Discord user ID must be 17–20 digits. In Discord, right-click the player and choose Copy User ID.',
    }
  }
  return { value: { name, discordId } }
}

/**
 * Add a member together with their main character; a member always has at least one character.
 * @returns {{ state: import('./model.js').AppState, memberId?: string, error?: string }}
 */
export function addMember(state, memberInput, characterInput, makeId = () => crypto.randomUUID()) {
  const member = validateMember(state, memberInput)
  if ('error' in member) return { state, error: member.error }
  const character = validateCharacter(characterInput)
  if (character.error) return { state, error: character.error }

  const memberId = makeId()
  return {
    state: {
      ...state,
      members: [...state.members, { id: memberId, ...member.value }],
      characters: [...state.characters, { id: makeId(), memberId, main: true, ...character.value }],
    },
    memberId,
  }
}

/** Rename a member or change their Discord ID. */
export function updateMember(state, memberId, input) {
  if (!state.members.some((m) => m.id === memberId)) return { state, error: 'Player not found.' }
  const member = validateMember(state, input, memberId)
  if ('error' in member) return { state, error: member.error }
  return {
    state: {
      ...state,
      members: state.members.map((m) => (m.id === memberId ? { ...m, ...member.value } : m)),
    },
  }
}

/**
 * Remove a member and everything that refers to them: characters, weekly check-ins, and roster
 * entries, locks, and attendance in every plan. The last member cannot be removed. Removing the
 * member you are acting as switches you to the first remaining member.
 */
export function removeMember(state, memberId) {
  if (!state.members.some((m) => m.id === memberId)) return { state, error: 'Player not found.' }
  if (state.members.length === 1) return { state, error: 'A guild needs at least one player.' }

  const members = state.members.filter((m) => m.id !== memberId)
  const weeks = Object.fromEntries(
    Object.entries(state.weeks).map(([weekIso, week]) => {
      const { [memberId]: _removed, ...checkins } = week.checkins
      const plan = week.plan && planWithout(week.plan, (e) => e.memberId === memberId)
      return [weekIso, { ...week, checkins, plan }]
    }),
  )
  return {
    state: {
      ...state,
      members,
      characters: state.characters.filter((c) => c.memberId !== memberId),
      weeks,
      currentMemberId: state.currentMemberId === memberId ? members[0].id : state.currentMemberId,
    },
  }
}

/** Act as another member (this prototype has no login). Unknown IDs are ignored. */
export function setCurrentMember(state, memberId) {
  return state.members.some((m) => m.id === memberId) ? { ...state, currentMemberId: memberId } : state
}
