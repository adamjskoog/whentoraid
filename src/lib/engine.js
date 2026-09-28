import { ROLES } from './constants.js'
import { covers } from './intervals.js'

/**
 * @typedef {import('./intervals.js').Interval} Interval
 * @typedef {{ id: string, role: string, main: boolean, offered: boolean }} EngineCharacter
 * @typedef {{ id: string, checkedIn: boolean, ranges: Interval[], characters: EngineCharacter[], priority?: number }} EnginePlayer
 *   `priority` is how often the player recently sat out while available; higher is picked first on ties.
 * @typedef {{ memberId: string, characterId: string, role: string }} RosterEntry
 * @typedef {{ team: RosterEntry[], fairness: number, mains: number }} Composition
 */

/** Among rosters that fill the same slots: prefer players who sat out recently, then main characters. */
function isBetter(a, b) {
  return a.fairness !== b.fairness ? a.fairness > b.fairness : a.mains > b.mains
}

/** A player counts only if they checked in this week and are free for the entire session. */
export function isAvailable(player, window) {
  return Boolean(player.checkedIn) && window.end > window.start && covers(player.ranges, window)
}

/**
 * Dynamic programming: one character per person. Maximize filled role slots, then prefer players who
 * sat out recently (`priority`), then main characters. Gear is deliberately not a proxy for skill.
 * `locked` entries are kept exactly as given, occupy their role slots, and are not re-placed.
 * @param {EnginePlayer[]} players
 * @param {{ start: number, end: number }} window
 * @param {number[]} targets
 * @param {{ locked?: RosterEntry[] }} [options]
 * @returns {Composition}
 */
export function compose(players, window, targets, { locked = [] } = {}) {
  const lockedIds = new Set(locked.map((e) => e.memberId))
  const lockedCounts = ROLES.map((role) => locked.filter((e) => e.role === role).length)
  let states = new Map([
    [lockedCounts.join(','), { counts: lockedCounts, fairness: 0, mains: 0, team: [...locked] }],
  ])

  for (const player of players.filter((p) => !lockedIds.has(p.id) && isAvailable(p, window))) {
    const next = new Map(states)
    for (const state of states.values()) {
      for (const character of player.characters.filter((c) => c.offered)) {
        const roleIndex = ROLES.indexOf(character.role)
        if (roleIndex < 0 || state.counts[roleIndex] >= targets[roleIndex]) continue

        const entry = { memberId: player.id, characterId: character.id, role: character.role }
        const candidate = {
          counts: state.counts.map((n, i) => (i === roleIndex ? n + 1 : n)),
          fairness: state.fairness + (player.priority ?? 0),
          mains: state.mains + (character.main ? 1 : 0),
          team: [...state.team, entry],
        }
        const key = candidate.counts.join(',')
        const existing = next.get(key)
        if (!existing || isBetter(candidate, existing)) next.set(key, candidate)
      }
    }
    states = next
  }

  const best = [...states.values()].sort(
    (a, b) => b.team.length - a.team.length || b.fairness - a.fairness || b.mains - a.mains,
  )[0]
  return { team: best.team, fairness: best.fairness, mains: best.mains }
}

/**
 * Spare players per role (in ROLES order): free for the whole session, not on `team`,
 * and offering a character in that role. A flexible player counts toward each role they can fill.
 */
export function backups(players, window, team) {
  const onTeam = new Set(team.map((e) => e.memberId))
  const spare = players.filter((p) => !onTeam.has(p.id) && isAvailable(p, window))
  return ROLES.map(
    (role) => spare.filter((p) => p.characters.some((c) => c.offered && c.role === role)).length,
  )
}

/** Reasons a roster entry is questionable. Officers may still keep it. */
export function conflicts(entry, players, window) {
  const player = players.find((p) => p.id === entry.memberId)
  const character = player?.characters.find((c) => c.id === entry.characterId)
  if (!player || !character) return ['Character missing']

  return [
    ...(isAvailable(player, window) ? [] : ['Unavailable for full session']),
    ...(character.offered ? [] : ['Character not offered']),
    ...(character.role === entry.role ? [] : ['Role mismatch']),
  ]
}
