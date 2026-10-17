/**
 * Who a raid's sign-ups place where. Shared by the bot's sign-up post and the Planner's sign-up
 * panel, so both agree on who is benched. Pure, so Vitest runs it too.
 */

/** Role order of a raid's `targets`, matching ROLES in src/lib/constants.js. */
export const SIGNUP_ROLES = ['Tank', 'Healer', 'DPS']

const COMING = new Set(['signed', 'late'])

/**
 * @template {{ role?: string | null, status: string }} T
 * @param {T[]} signups in sign-up order
 * @param {number[]} [targets] players wanted per role, in SIGNUP_ROLES order; 0 means no limit
 * @returns {{
 *   roles: { role: string, target: number, members: (T & { number: number })[] }[],
 *   other: (T & { number: number })[], bench: (T & { number: number })[],
 *   tentative: T[], absent: T[], coming: number,
 * }}
 *   Everyone coming is numbered in sign-up order. Once a role has as many players as its target,
 *   later sign-ups for that role go to the bench (still coming; officers decide). Sign-ups without a
 *   known role are listed under `other` and never benched.
 */
export function signupLineup(signups, targets = []) {
  const coming = signups
    .filter((entry) => COMING.has(entry.status))
    .map((entry, i) => ({ ...entry, number: i + 1 }))
  const limits = SIGNUP_ROLES.map((_, i) => Math.max(0, Math.floor(Number(targets[i]) || 0)))
  const placed = SIGNUP_ROLES.map(() => [])
  const other = []
  const bench = []
  for (const entry of coming) {
    const index = SIGNUP_ROLES.indexOf(entry.role)
    if (index < 0) other.push(entry)
    else if (limits[index] && placed[index].length >= limits[index]) bench.push(entry)
    else placed[index].push(entry)
  }
  return {
    roles: SIGNUP_ROLES.map((role, i) => ({ role, target: limits[i], members: placed[i] })),
    other,
    bench,
    tentative: signups.filter((entry) => entry.status === 'tentative'),
    absent: signups.filter((entry) => entry.status === 'absent'),
    coming: coming.length,
  }
}
