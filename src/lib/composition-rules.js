import { CLASS_NAMES, CLASS_SPECS, MAX_RAID_SIZE } from './constants.js'
import { isSafeId, own } from './ids.js'

/**
 * Optional per-raid composition rules. Every field may be missing; missing means "no rule".
 * @typedef {{ class: string, spec?: string }} EligibleSpec  No `spec` accepts every spec of the class.
 * @typedef {{ id: string, name: string, eligible: EligibleSpec[] }} Utility
 *   A requirement met by any one rostered character matching an `eligible` entry.
 * @typedef {'fairness' | 'mains' | 'preferred'} RosterPriority
 *   What breaks ties between equally complete rosters: players who sat out recently (default),
 *   main characters, or players who marked the time as preferred.
 * @typedef {{ classLimits: Record<string, number>, requiredUtilities: Utility[], priority: RosterPriority }} CompositionRules
 */

export const ROSTER_PRIORITIES = ['fairness', 'mains', 'preferred']

/** Each requirement doubles the planner's search space, so keep the list short. */
export const MAX_UTILITIES = 6
const MAX_ELIGIBLE = 20
const MAX_UTILITY_NAME = 40

/** @returns {CompositionRules} a fresh copy, so callers can never edit a shared default. */
export function normalizeCompositionRules(rules = {}) {
  return {
    classLimits: { ...(rules?.classLimits ?? {}) },
    requiredUtilities: (rules?.requiredUtilities ?? []).map((utility) => ({
      ...utility,
      eligible: utility.eligible.map((entry) => ({ ...entry })),
    })),
    priority: rules?.priority ?? 'fairness',
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function eligibleError(entry) {
  if (!isObject(entry) || !CLASS_NAMES.includes(entry.class))
    return 'Choose a valid class for each requirement.'
  if (entry.spec !== undefined && !CLASS_SPECS[entry.class].includes(entry.spec))
    return `${entry.spec} is not a ${entry.class} specialization.`
  return null
}

function utilityError(utility) {
  if (!isObject(utility) || !isSafeId(utility.id)) return 'Each requirement needs a valid identifier.'
  const name = typeof utility.name === 'string' ? utility.name.trim() : ''
  if (!name || name.length > MAX_UTILITY_NAME)
    return `Requirement names must be between 1 and ${MAX_UTILITY_NAME} characters.`
  if (
    !Array.isArray(utility.eligible) ||
    utility.eligible.length < 1 ||
    utility.eligible.length > MAX_ELIGIBLE
  )
    return `${name} needs between 1 and ${MAX_ELIGIBLE} qualifying classes or specializations.`
  for (const entry of utility.eligible) {
    const error = eligibleError(entry)
    if (error) return error
  }
  return null
}

/** @returns {string | null} why the rules cannot be saved, or null when they are valid */
export function validateCompositionRules(rules) {
  if (rules === undefined) return null
  if (!isObject(rules)) return 'Composition rules are malformed.'
  const { classLimits = {}, requiredUtilities = [], priority = 'fairness' } = rules
  if (!isObject(classLimits)) return 'Class limits are malformed.'
  for (const [className, limit] of Object.entries(classLimits)) {
    if (!CLASS_NAMES.includes(className)) return `${className} is not a class.`
    if (!Number.isInteger(limit) || limit < 0 || limit > MAX_RAID_SIZE)
      return `Class limits must be whole numbers from 0 to ${MAX_RAID_SIZE}.`
  }
  if (!Array.isArray(requiredUtilities) || requiredUtilities.length > MAX_UTILITIES)
    return `Choose at most ${MAX_UTILITIES} required utilities.`
  const ids = new Set()
  for (const utility of requiredUtilities) {
    const error = utilityError(utility)
    if (error) return error
    if (ids.has(utility.id)) return 'Each requirement needs a different identifier.'
    ids.add(utility.id)
  }
  if (!ROSTER_PRIORITIES.includes(priority)) return 'Choose a valid roster priority.'
  return null
}

/** Whether `character` (with `class` and `spec`) satisfies the requirement. */
export function meetsUtility(utility, character) {
  return utility.eligible.some(
    (entry) => entry.class === character.class && (entry.spec === undefined || entry.spec === character.spec),
  )
}

/** "Frost Mage or Paladin": what an officer could add to satisfy the requirement. */
export function eligibleLabel(utility) {
  return utility.eligible
    .map((entry) => (entry.spec ? `${entry.spec} ${entry.class}` : entry.class))
    .join(' or ')
}

/**
 * Rule problems in a roster. Officers may keep a roster with issues; they are warnings.
 * @param {{ characterId: string }[]} team
 * @param {{ id: string, class: string, spec: string }[]} characters every character the team may use
 * @param {Partial<CompositionRules>} [rules]
 */
export function compositionIssues(team, characters, rules) {
  const { classLimits, requiredUtilities } = normalizeCompositionRules(rules)
  const byId = new Map(characters.map((c) => [c.id, c]))
  const rostered = team.map((entry) => byId.get(entry.characterId)).filter(Boolean)
  const overLimit = Object.entries(classLimits).flatMap(([className, limit]) => {
    const count = rostered.filter((c) => c.class === className).length
    return count > limit
      ? [
          {
            code: 'class-limit',
            className,
            count,
            limit,
            message: `${count} ${className} rostered; the limit is ${limit}.`,
          },
        ]
      : []
  })
  const missing = requiredUtilities
    .filter((utility) => !rostered.some((c) => meetsUtility(utility, c)))
    .map((utility) => ({
      code: 'missing-utility',
      utilityId: utility.id,
      message: `${utility.name.trim()} needs a ${eligibleLabel(utility)}.`,
    }))
  return [...overLimit, ...missing]
}

/** Whether rules change nothing, so they need not be stored. */
function isEmptyRules({ classLimits, requiredUtilities, priority }) {
  return !Object.keys(classLimits).length && !requiredUtilities.length && priority === 'fairness'
}

/**
 * Save one raid profile's composition rules. Empty rules are removed rather than stored.
 * @returns {{ state: import('./model.js').AppState, error?: string }}
 */
export function saveRaidRules(state, raidId, rules) {
  if (!state.settings.raids.some((raid) => raid.id === raidId)) return { state, error: 'Raid not found.' }
  const error = validateCompositionRules(rules)
  if (error) return { state, error }
  const normalized = normalizeCompositionRules(rules)
  const tidy = {
    ...normalized,
    requiredUtilities: normalized.requiredUtilities.map((utility) => ({
      ...utility,
      name: utility.name.trim(),
    })),
  }
  const raids = state.settings.raids.map((raid) => {
    if (raid.id !== raidId) return raid
    const { rules: _previous, ...rest } = raid
    return isEmptyRules(tidy) ? rest : { ...rest, rules: tidy }
  })
  return { state: { ...state, settings: { ...state.settings, raids } } }
}

/** A raid's rules, normalized; raids saved before rules existed have none. */
export function raidRules(raid) {
  return normalizeCompositionRules(own(raid ?? {}, 'rules'))
}
