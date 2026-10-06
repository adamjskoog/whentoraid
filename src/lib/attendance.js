import { getWeek, updateWeek } from './model.js'
import { addDays } from './time.js'

/** What happened for a rostered member once the raid ran. */
export const ATTENDANCE_OPTIONS = [
  { value: 'attended', label: 'Attended' },
  { value: 'late', label: 'Late' },
  { value: 'noshow', label: 'No-show' },
]

/** How many weeks, ending with the current one, count toward a member's attendance record. */
export const RECORD_LOOKBACK_WEEKS = 8
const DAYS_PER_WEEK = 7

function withPlan(state, weekIso, update) {
  if (!getWeek(state, weekIso).plan) return state
  return updateWeek(state, weekIso, (week) => ({
    ...week,
    plans: { ...week.plans, [state.currentRaidId]: update(week.plans[state.currentRaidId]) },
  }))
}

/**
 * Record attendance for a rostered member, or clear it with `status` null.
 * Members not on the saved roster are ignored.
 */
export function setAttendance(state, weekIso, memberId, status) {
  const plan = getWeek(state, weekIso).plan
  if (!plan?.team.some((e) => e.memberId === memberId)) return state
  return withPlan(state, weekIso, (current) => {
    const { [memberId]: _previous, ...others } = current.attendance ?? {}
    return { ...current, attendance: status ? { ...others, [memberId]: status } : others }
  })
}

/** Mark the week's raid as cancelled (it did not run) or not. Needs a saved plan. */
export function setCancelled(state, weekIso, cancelled) {
  return withPlan(state, weekIso, (current) => ({ ...current, cancelled }))
}

/**
 * A member's recorded attendance over the last `lookback` weeks, ending with `weekIso`.
 * Cancelled raids and rostered weeks with nothing recorded are left out.
 * @returns {{ attended: number, late: number, noshow: number }}
 */
export function attendanceRecord(state, weekIso, memberId, lookback = RECORD_LOOKBACK_WEEKS) {
  const record = { attended: 0, late: 0, noshow: 0 }
  for (let weeksAgo = 0; weeksAgo < lookback; weeksAgo++) {
    const plans = state.weeks[addDays(weekIso, -DAYS_PER_WEEK * weeksAgo)]?.plans ?? {}
    for (const plan of Object.values(plans)) {
      const status = !plan.cancelled ? plan.attendance?.[memberId] : undefined
      if (status in record) record[status] += 1
    }
  }
  return record
}

/** "5 attended · 1 late · 0 no-show", or null when nothing is recorded. */
export function formatRecord({ attended, late, noshow }) {
  if (attended + late + noshow === 0) return null
  return `${attended} attended · ${late} late · ${noshow} no-show`
}
