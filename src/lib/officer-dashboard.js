import { waitingOn } from './checkins.js'
import { compositionIssues } from './composition-rules.js'
import { conflicts } from './engine.js'
import { own } from './ids.js'
import { plannerPlayers } from './planning.js'
import { planWindow } from './raid-workflow.js'
import { seriesOccurrences } from './raid-series.js'
import { stableJson } from './remote/rows.js'
import { addDays, mondayOf, todayIso } from './time.js'

/** Weeks the dashboard looks ahead, this week included. */
export const DASHBOARD_WEEKS = 4
/** Every raid profile is expected weekly this soon; later weeks show only scheduled or saved raids. */
const ALWAYS_SHOWN_WEEKS = 2

/**
 * @typedef {{ code: string, message: string }} DashboardIssue
 * @typedef {{
 *   weekIso: string, raidId: string, raidName: string, start: number | null, status: string,
 *   published: object | null, issues: DashboardIssue[],
 * }} DashboardRaid
 * @typedef {{ weekIso: string, waiting: number | null, raids: DashboardRaid[] }} DashboardWeek
 *   `waiting` counts players who have not checked in; null for weeks too far ahead to expect it.
 */

function sameRoster(plan) {
  const { published } = plan
  return published.start === plan.start && stableJson(published.team) === stableJson(plan.team)
}

/** What still needs an officer for one saved plan. Players are evaluated as the planner would. */
function planIssues(state, weekIso, raid, plan) {
  const scoped = { ...state, currentWeek: weekIso, currentRaidId: raid.id }
  const players = plannerPlayers(scoped)
  const window = planWindow(state, raid.id, plan)
  const issues = []
  if (!plan.published) issues.push({ code: 'unpublished', message: 'Not published yet' })
  else if (!sameRoster(plan)) issues.push({ code: 'draft-changes', message: 'Draft changes not published' })
  const open = raid.targets.reduce((sum, n) => sum + n, 0) - plan.team.length
  if (open > 0) issues.push({ code: 'open-slots', message: `${open} open ${open === 1 ? 'slot' : 'slots'}` })
  const reasons = plan.team.map((entry) => conflicts(entry, players, window))
  const isTentative = (reason) => reason.startsWith('Tentative')
  const blocked = reasons.filter((list) => list.some((reason) => !isTentative(reason))).length
  const tentative = reasons.filter((list) => list.some(isTentative)).length
  if (blocked)
    issues.push({
      code: 'conflicts',
      message: `${blocked} rostered ${blocked === 1 ? 'player needs' : 'players need'} review`,
    })
  if (tentative)
    issues.push({
      code: 'tentative',
      message: `${tentative} tentative ${tentative === 1 ? 'player' : 'players'} to confirm`,
    })
  const characters = players.flatMap((p) => p.characters)
  for (const issue of compositionIssues(plan.team, characters, raid.rules))
    issues.push({ code: issue.code, message: issue.message })
  return issues
}

function raidEntry(state, weekIso, raid, now) {
  const plan = own(state.weeks[weekIso]?.plans, raid.id)
  const occurrence = raid.series ? seriesOccurrences(raid.series).find((o) => o.weekIso === weekIso) : null
  const base = { weekIso, raidId: raid.id, raidName: raid.name, published: plan?.published ?? null }
  if (!plan) {
    if (occurrence?.start != null && occurrence.start <= now) return null
    if (occurrence?.cancelled) return { ...base, start: occurrence.start, status: 'cancelled', issues: [] }
    return {
      ...base,
      start: occurrence?.start ?? null,
      status: 'unplanned',
      issues: [{ code: 'unplanned', message: occurrence ? 'Scheduled · no draft yet' : 'Not planned yet' }],
    }
  }
  if (planWindow(state, raid.id, plan).end <= now) return null
  if (plan.cancelled) return { ...base, start: plan.start, status: 'cancelled', issues: [] }
  const issues = planIssues(state, weekIso, raid, plan)
  return { ...base, start: plan.start, status: plan.published ? 'published' : 'draft', issues }
}

function isListed(state, weekIso, raid, index) {
  if (index < ALWAYS_SHOWN_WEEKS || own(state.weeks[weekIso]?.plans, raid.id)) return true
  return Boolean(raid.series && seriesOccurrences(raid.series).some((o) => o.weekIso === weekIso))
}

/**
 * Upcoming raids that need officer attention, by week: this week and the next few. Every raid profile
 * appears for this week and next; later weeks list raids that are scheduled or already saved.
 * @returns {DashboardWeek[]}
 */
export function officerDashboard(state, now = Date.now(), weeks = DASHBOARD_WEEKS) {
  const thisWeek = mondayOf(todayIso(state.guild.timezone, now))
  return Array.from({ length: weeks }, (_, i) => addDays(thisWeek, 7 * i)).map((weekIso, i) => ({
    weekIso,
    waiting: i < ALWAYS_SHOWN_WEEKS ? waitingOn(state, weekIso).length : null,
    raids: state.settings.raids
      .filter((raid) => isListed(state, weekIso, raid, i))
      .map((raid) => raidEntry(state, weekIso, raid, now))
      .filter(Boolean)
      .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity)),
  }))
}

/** How many listed raids need attention. */
export function attentionCount(weeks) {
  return weeks.reduce((sum, week) => sum + week.raids.filter((raid) => raid.issues.length).length, 0)
}
