import { ROLES } from './constants.js'
import { compositionIssues, meetsUtility, normalizeCompositionRules } from './composition-rules.js'
import { covers, normalize } from './intervals.js'

/**
 * @typedef {import('./intervals.js').Interval} Interval
 * @typedef {{ id: string, role: string, main: boolean, offered: boolean, class?: string, spec?: string }} EngineCharacter
 * @typedef {{
 *   id: string, checkedIn: boolean, ranges: Interval[], characters: EngineCharacter[], priority?: number,
 *   tentativeRanges?: Interval[], preferredRanges?: Interval[],
 * }} EnginePlayer
 *   `priority` is how often the player recently sat out while available; higher is picked first on ties.
 *   `ranges` are firm times; `tentativeRanges` are maybes and never overlap them; `preferredRanges`
 *   are firm times the player would most like to raid.
 * @typedef {{ memberId: string, characterId: string, role: string }} RosterEntry
 * @typedef {{
 *   team: RosterEntry[], fairness: number, mains: number, preferred: number, firm: number, tentative: number,
 *   utilityCount: number, issues: { code: string, message: string }[],
 * }} Composition
 * @typedef {'firm' | 'tentative' | 'unavailable'} AvailabilityState
 */

/** Tie-breakers after filled slots, required utilities and firm players, by roster priority. */
const TIE_BREAKERS = {
  fairness: ['fairness', 'mains', 'preferred'],
  mains: ['mains', 'fairness', 'preferred'],
  preferred: ['preferred', 'fairness', 'mains'],
}

/**
 * Whether a checked-in player can stay for the whole session, and whether that is a firm answer.
 * Tentative times fill gaps in firm times, so a session partly firm and partly tentative is tentative.
 * @returns {AvailabilityState}
 */
export function availabilityState(player, window) {
  if (!player.checkedIn || !(window.end > window.start)) return 'unavailable'
  if (overlappingCommitments(player, window).length) return 'unavailable'
  if (covers(player.ranges, window)) return 'firm'
  const any = normalize([...player.ranges, ...(player.tentativeRanges ?? [])])
  return covers(any, window) ? 'tentative' : 'unavailable'
}

/** A player counts only if they checked in this week and are free (firmly or tentatively) for the entire session. */
export function isAvailable(player, window) {
  return availabilityState(player, window) !== 'unavailable'
}

/** Published assignments reserve a player, including on their alts and across week boundaries. */
export function overlappingCommitments(player, window) {
  return (player.commitments ?? []).filter((other) => other.start < window.end && other.end > window.start)
}

function isBetter(a, b, order) {
  for (const key of order) if (a[key] !== b[key]) return a[key] > b[key]
  return false
}

function bitCount(mask) {
  let count = 0
  for (let rest = mask; rest; rest &= rest - 1) count += 1
  return count
}

/**
 * Dynamic programming: one character per person. Maximize filled role slots, then required utilities
 * covered, then firm (not tentative) players, then the raid's roster priority (by default players who
 * sat out recently, then main characters). Suggestions never exceed a class limit. Gear is
 * deliberately not a proxy for skill.
 * `locked` entries are kept exactly as given, occupy their role slots, and are not re-placed.
 * @param {EnginePlayer[]} players
 * @param {{ start: number, end: number }} window
 * @param {number[]} targets
 * @param {{ locked?: RosterEntry[], rules?: Partial<import('./composition-rules.js').CompositionRules> }} [options]
 * @returns {Composition}
 */
export function compose(players, window, targets, { locked = [], rules } = {}) {
  const { classLimits, requiredUtilities, priority } = normalizeCompositionRules(rules)
  const order = ['firm', ...(TIE_BREAKERS[priority] ?? TIE_BREAKERS.fairness)]
  const limitedClasses = Object.keys(classLimits)
  const characterOf = (entry) =>
    players.find((p) => p.id === entry.memberId)?.characters.find((c) => c.id === entry.characterId)
  const utilityMask = (character) =>
    character
      ? requiredUtilities.reduce(
          (mask, utility, i) => (meetsUtility(utility, character) ? mask | (1 << i) : mask),
          0,
        )
      : 0

  const lockedIds = new Set(locked.map((e) => e.memberId))
  const lockedCharacters = locked.map(characterOf)
  const initial = {
    counts: ROLES.map((role) => locked.filter((e) => e.role === role).length),
    classCounts: limitedClasses.map((name) => lockedCharacters.filter((c) => c?.class === name).length),
    utilities: lockedCharacters.reduce((mask, c) => mask | utilityMask(c), 0),
    fairness: 0,
    mains: 0,
    preferred: 0,
    firm: 0,
    tentative: 0,
    team: [...locked],
  }
  const keyOf = (state) => `${state.counts.join(',')}|${state.classCounts.join(',')}|${state.utilities}`
  let states = new Map([[keyOf(initial), initial]])

  for (const player of players.filter((p) => !lockedIds.has(p.id))) {
    const availability = availabilityState(player, window)
    if (availability === 'unavailable') continue
    const isFirm = availability === 'firm'
    const prefers = isFirm && covers(player.preferredRanges ?? [], window)
    const next = new Map(states)
    for (const state of states.values()) {
      for (const character of player.characters.filter((c) => c.offered)) {
        const roleIndex = ROLES.indexOf(character.role)
        if (roleIndex < 0 || state.counts[roleIndex] >= targets[roleIndex]) continue
        const classIndex = limitedClasses.indexOf(character.class)
        if (classIndex >= 0 && state.classCounts[classIndex] >= classLimits[character.class]) continue

        const candidate = {
          counts: state.counts.map((n, i) => (i === roleIndex ? n + 1 : n)),
          classCounts: state.classCounts.map((n, i) => (i === classIndex ? n + 1 : n)),
          utilities: state.utilities | utilityMask(character),
          fairness: state.fairness + (player.priority ?? 0),
          mains: state.mains + (character.main ? 1 : 0),
          preferred: state.preferred + (prefers ? 1 : 0),
          firm: state.firm + (isFirm ? 1 : 0),
          tentative: state.tentative + (isFirm ? 0 : 1),
          team: [...state.team, { memberId: player.id, characterId: character.id, role: character.role }],
        }
        const key = keyOf(candidate)
        const existing = next.get(key)
        if (!existing || isBetter(candidate, existing, order)) next.set(key, candidate)
      }
    }
    states = next
  }

  const covered = (state) => bitCount(state.utilities)
  const best = [...states.values()].reduce((a, b) => {
    if (a.team.length !== b.team.length) return b.team.length > a.team.length ? b : a
    if (covered(a) !== covered(b)) return covered(b) > covered(a) ? b : a
    return isBetter(b, a, order) ? b : a
  })
  return {
    team: best.team,
    fairness: best.fairness,
    mains: best.mains,
    preferred: best.preferred,
    firm: best.firm,
    tentative: best.tentative,
    utilityCount: covered(best),
    issues: compositionIssues(
      best.team,
      players.flatMap((p) => p.characters),
      rules,
    ),
  }
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

  const availability = availabilityState({ ...player, commitments: [] }, window)
  return [
    ...(availability === 'unavailable' ? ['Unavailable for full session'] : []),
    ...(availability === 'tentative' ? ['Tentative availability — confirm before publishing'] : []),
    ...overlappingCommitments(player, window).map((other) => `Committed to ${other.raidName}`),
    ...(character.offered ? [] : ['Character not offered']),
    ...(character.role === entry.role ? [] : ['Role mismatch']),
  ]
}
