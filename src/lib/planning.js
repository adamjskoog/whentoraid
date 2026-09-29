import { ROLES, SLOT_MINUTES } from './constants.js'
import { backups, compose, isAvailable } from './engine.js'
import { clampStartSlot, sessionWindows, slotWindow } from './grid.js'
import { enginePlayers, getWeek, saveSettings, setPlan } from './model.js'
import { addDays } from './time.js'

/** How many previous weeks count toward bench fairness. */
export const BENCH_LOOKBACK_WEEKS = 4
const DAYS_PER_WEEK = 7
const MINUTE_MS = 60_000

/**
 * @typedef {import('./engine.js').RosterEntry} RosterEntry
 * @typedef {import('./grid.js').SessionWindow} SessionWindow
 * @typedef {SessionWindow & import('./engine.js').Composition & { backups: number[], thinnest: number }} Suggestion
 * @typedef {SessionWindow & { team: RosterEntry[], locked: string[], saved: boolean }} ResolvedPlan
 */

/**
 * For each member, how many of the previous weeks they were free for the planned session,
 * offering a character, and still left off the roster.
 * Past sessions are assumed to have run for the current raid duration.
 * @returns {Map<string, number>}
 */
export function benchHistory(state, weekIso, lookbackWeeks = BENCH_LOOKBACK_WEEKS) {
  const durationMs = state.settings.durationSlots * SLOT_MINUTES * MINUTE_MS
  const counts = new Map()
  for (let weeksAgo = 1; weeksAgo <= lookbackWeeks; weeksAgo++) {
    const pastWeek = addDays(weekIso, -DAYS_PER_WEEK * weeksAgo)
    const plan = state.weeks[pastWeek]?.plan
    // Nobody sat out of a raid that did not happen.
    if (!plan || plan.cancelled) continue

    const window = { start: plan.start, end: plan.start + durationMs }
    const rostered = new Set(plan.team.map((e) => e.memberId))
    for (const player of enginePlayers(state, pastWeek)) {
      const satOut =
        !rostered.has(player.id) && isAvailable(player, window) && player.characters.some((c) => c.offered)
      if (satOut) counts.set(player.id, (counts.get(player.id) ?? 0) + 1)
    }
  }
  return counts
}

/** Backups for the weakest role that the raid actually needs. */
function thinnestBackup(spare, targets) {
  const needed = spare.filter((_, i) => targets[i] > 0)
  return needed.length ? Math.min(...needed) : 0
}

const ROLE_LETTERS = { Tank: 'T', Healer: 'H', DPS: 'D' }

/** Backups per role, e.g. "1 T · 2 H · 5 D". */
export function formatBackups(spare) {
  return ROLES.map((role, i) => `${spare[i]} ${ROLE_LETTERS[role]}`).join(' · ')
}

const sum = (numbers) => numbers.reduce((total, n) => total + n, 0)

/**
 * Best roster for every possible session start, best first: most slots filled, then the most backups
 * for the thinnest role, then the most backups overall, then fairness and mains, then earliest.
 * @returns {Suggestion[]}
 */
export function rankSuggestions(windows, players, targets) {
  return windows
    .map((window) => {
      const composition = compose(players, window, targets)
      const spare = backups(players, window, composition.team)
      return { ...window, ...composition, backups: spare, thinnest: thinnestBackup(spare, targets) }
    })
    .sort(
      (a, b) =>
        b.team.length - a.team.length ||
        b.thinnest - a.thinnest ||
        sum(b.backups) - sum(a.backups) ||
        b.fairness - a.fairness ||
        b.mains - a.mains ||
        a.day - b.day ||
        a.startSlot - b.startSlot,
    )
}

/** The best suggestion on each of the first `limit` distinct days. */
export function topDistinctDays(suggestions, limit) {
  return suggestions.reduce((picked, s) => {
    if (picked.length >= limit || picked.some((p) => p.day === s.day)) return picked
    return [...picked, s]
  }, [])
}

/**
 * The officer's saved plan for the week, or the top suggestion if none is saved.
 * @returns {ResolvedPlan}
 */
export function resolvePlan(savedPlan, windows, suggestions) {
  const window = savedPlan && windows.find((w) => w.start === savedPlan.start)
  if (window) return { ...window, team: savedPlan.team, locked: savedPlan.locked ?? [], saved: true }
  const top = suggestions[0]
  return {
    day: top.day,
    startSlot: top.startSlot,
    start: top.start,
    end: top.end,
    team: top.team,
    locked: [],
    saved: false,
  }
}

/** This week's players, each with a `priority` from recent bench history. */
export function plannerPlayers(state) {
  const history = benchHistory(state, state.currentWeek)
  return enginePlayers(state, state.currentWeek).map((p) => ({ ...p, priority: history.get(p.id) ?? 0 }))
}

export function plannerContext(state) {
  const weekIso = state.currentWeek
  const players = plannerPlayers(state)
  const windows = sessionWindows(weekIso, state.settings.durationSlots, state.guild)
  const suggestions = rankSuggestions(windows, players, state.settings.targets)
  const plan = resolvePlan(getWeek(state, weekIso).plan, windows, suggestions)
  return { players, windows, suggestions, plan }
}

/**
 * Best roster for a window that keeps every locked member exactly where they are.
 * @param {RosterEntry[]} team current roster, which holds the locked members' entries
 * @param {string[]} locked member IDs
 * @returns {RosterEntry[]}
 */
export function rebuildTeam(players, window, targets, team, locked) {
  const lockedEntries = team.filter((e) => locked.includes(e.memberId))
  return compose(players, window, targets, { locked: lockedEntries }).team
}

/**
 * Put one member's character in a role, replacing any spot they already hold.
 * @returns {{ team: RosterEntry[] } | { error: string }}
 */
export function placeInRoster(team, entry, targets) {
  const roleIndex = ROLES.indexOf(entry.role)
  if (roleIndex < 0) return { error: `Unknown role: ${entry.role}` }

  const others = team.filter((e) => e.memberId !== entry.memberId)
  if (others.filter((e) => e.role === entry.role).length >= targets[roleIndex]) {
    return { error: `${entry.role} slots are full. Move someone to the bench first.` }
  }
  return { team: [...others, entry] }
}

export function benchMember(team, memberId) {
  return team.filter((e) => e.memberId !== memberId)
}

const MISSING_LABELS = {
  Tank: ['tank', 'tanks'],
  Healer: ['healer', 'healers'],
  DPS: ['damage dealer', 'damage dealers'],
}

/** Roles the team is short of, in ROLES order. */
export function missingRoles(team, targets) {
  return ROLES.map((role, i) => ({
    role,
    missing: targets[i] - team.filter((e) => e.role === role).length,
  })).filter((m) => m.missing > 0)
}

/** "Short 1 tank, 2 healers", or null when every slot is filled. */
export function formatMissing(missing) {
  if (missing.length === 0) return null
  const parts = missing.map(({ role, missing: n }) => `${n} ${MISSING_LABELS[role][n === 1 ? 0 : 1]}`)
  return `Short ${parts.join(', ')}`
}

/**
 * Member IDs not on the team, grouped by why: `available` can stay the whole session and offers a
 * character; `unavailable` answered but cannot make it (or offers nothing); `waiting` has not checked in.
 * Order follows `players`.
 */
export function benchGroups(players, window, team) {
  const onTeam = new Set(team.map((e) => e.memberId))
  const groups = { available: [], unavailable: [], waiting: [] }
  for (const player of players) {
    if (onTeam.has(player.id)) continue
    const canCome = isAvailable(player, window) && player.characters.some((c) => c.offered)
    const group = !player.checkedIn ? 'waiting' : canCome ? 'available' : 'unavailable'
    groups[group].push(player.id)
  }
  return groups
}

export function toggleLock(locked, memberId) {
  return locked.includes(memberId) ? locked.filter((id) => id !== memberId) : [...locked, memberId]
}

/**
 * The start slot in `next`'s grid with the same clock time as `startSlot` in `prev`'s grid (slot
 * numbers count from the day start), moved earlier if needed so the session still fits.
 */
function sameClockSlot(startSlot, prev, next) {
  const shift = ((prev.guild.dayStartHour - next.guild.dayStartHour) * 60) / SLOT_MINUTES
  return clampStartSlot(startSlot + shift, next.settings.durationSlots, next.guild)
}

/**
 * After the guild's timezone or hours change, move every saved plan to the same day and clock time
 * on the new grid, keeping its roster, locks, attendance, and cancelled flag. Plans that did not sit
 * on the old grid are left alone.
 */
function realignPlans(prev, next) {
  const gridChanged = ['timezone', 'dayStartHour', 'slotsPerDay'].some((k) => prev.guild[k] !== next.guild[k])
  if (!gridChanged) return next

  const weeks = Object.fromEntries(
    Object.entries(next.weeks).map(([weekIso, week]) => {
      const old =
        week.plan &&
        sessionWindows(weekIso, prev.settings.durationSlots, prev.guild).find(
          (w) => w.start === week.plan.start,
        )
      if (!old) return [weekIso, week]
      const startSlot = sameClockSlot(old.startSlot, prev, next)
      const { start } = slotWindow(weekIso, old.day, startSlot, next.settings.durationSlots, next.guild)
      return [weekIso, { ...week, plan: { ...week.plan, start } }]
    }),
  )
  return { ...next, weeks }
}

const sameNumbers = (a, b) => a.length === b.length && a.every((n, i) => n === b[i])

/**
 * Save raid requirements and guild details. Saved plans keep their clock time on the new grid.
 * The current week's roster is rebuilt around locked players only when the raid itself changed
 * (role slots or duration) or its session had to move to fit new hours; otherwise the roster and any
 * recorded attendance stay as they are.
 * @returns {{ state: import('./model.js').AppState, error?: string }}
 */
export function applySettings(state, input) {
  const { plan: before } = plannerContext(state)
  const saved = saveSettings(state, input)
  if (saved.error) return saved

  const next = realignPlans(state, saved.state)
  const { durationSlots, targets } = next.settings
  const startSlot = sameClockSlot(before.startSlot, state, next)
  const window = slotWindow(next.currentWeek, before.day, startSlot, durationSlots, next.guild)

  const sameRaid =
    sameNumbers(targets, state.settings.targets) && durationSlots === state.settings.durationSlots
  const savedStart = getWeek(next, next.currentWeek).plan?.start
  if (sameRaid && before.saved && savedStart === window.start) return { state: next }

  const team = rebuildTeam(plannerPlayers(next), window, targets, before.team, before.locked)
  return { state: setPlan(next, next.currentWeek, { start: window.start, team, locked: before.locked }) }
}
