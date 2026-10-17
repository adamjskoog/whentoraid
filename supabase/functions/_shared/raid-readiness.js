/** Shared, explainable signup readiness. A late signup holds a place, but is not ready at pull. */
import { signupLineup } from './signup-lineup.js'

const LABELS = { Tank: 'tank', Healer: 'healer', DPS: 'DPS' }
export function roleNeeds(roles) {
  return roles
    .filter(({ missing }) => missing > 0)
    .map(({ role, missing }) => `${missing} ${LABELS[role]}${missing > 1 && role !== 'DPS' ? 's' : ''}`)
    .join(', ')
}

export function signupReadiness(signups, targets) {
  const lineup = signupLineup(signups, targets)
  const roles = lineup.roles.map(({ role, target, members }) => ({
    role,
    target,
    filled: members.length,
    missing: Math.max(0, target - members.length),
    late: members.filter((entry) => entry.status === 'late').length,
  }))
  return {
    roles,
    needed: roleNeeds(roles),
    late: roles.reduce((sum, role) => sum + role.late, 0),
    bench: lineup.bench.length,
    tentative: lineup.tentative.length,
    unknown: lineup.other.length,
    hasTargets: roles.some(({ target }) => target > 0),
  }
}

export function readinessText(readiness) {
  const parts = [
    readiness.needed
      ? `Still need ${readiness.needed}.`
      : readiness.hasTargets
        ? 'Signup role targets filled.'
        : 'No role targets set.',
  ]
  if (readiness.late)
    parts.push(
      `${readiness.late} slotted ${readiness.late === 1 ? 'player arrives' : 'players arrive'} late.`,
    )
  if (readiness.tentative) parts.push(`${readiness.tentative} tentative; not counted toward role targets.`)
  if (readiness.unknown) parts.push(`${readiness.unknown} without a role; not counted toward role targets.`)
  return parts.join(' ')
}
