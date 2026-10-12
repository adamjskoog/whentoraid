import { conflicts, isAvailable } from './engine.js'
import { clampStartSlot, slotWindow } from './grid.js'
import { characterById, memberById, getCheckin, getWeek, setPlan, updateWeek } from './model.js'
import { getRaid } from './raids.js'
import { addDays, wallTime, weekdayIndex } from './time.js'
import { ROLES } from './constants.js'
import { stableJson } from './remote/rows.js'

export function planWindow(state, raidId, plan) {
  return { ...plan, end: plan.end ?? plan.start + getRaid(state, raidId).durationSlots * 1800000 }
}

/** Saved plans only: unsaved suggestions are not commitments. Adjacent weeks count for overnight raids. */
export function overlappingPlayers(state, weekIso, raidId, candidate, publishedOnly = false) {
  const mine = new Set(candidate.team.map((entry) => entry.memberId))
  const result = []
  for (const [week, data] of Object.entries(state.weeks)) {
    for (const [otherId, draft] of Object.entries(data.plans)) {
      if (week === weekIso && otherId === raidId) continue
      if (draft.cancelled) continue
      const other = publishedOnly ? draft.published : draft
      if (!other) continue
      const window = planWindow(state, otherId, other)
      if (candidate.start >= window.end || window.start >= candidate.end) continue
      const memberIds = other.team.filter((entry) => mine.has(entry.memberId)).map((entry) => entry.memberId)
      if (memberIds.length)
        result.push({ raidId: otherId, raidName: getRaid(state, otherId).name, week, memberIds })
    }
  }
  return result
}

export function weeklyOverview(state, weekIso, publishedOnly = false) {
  return state.settings.raids.map((raid) => {
    const draft = state.weeks[weekIso]?.plans[raid.id]
    const selected = publishedOnly ? draft?.published : draft
    const plan = selected ? planWindow(state, raid.id, selected) : null
    return {
      raid,
      plan,
      cancelled: Boolean(draft?.cancelled),
      published: Boolean(draft?.published),
      overlaps:
        plan && !draft.cancelled ? overlappingPlayers(state, weekIso, raid.id, plan, publishedOnly) : [],
    }
  })
}

function snapshot(state, plan) {
  const raid = getRaid(state)
  return {
    start: plan.start,
    end: plan.end,
    day: plan.day,
    startSlot: plan.startSlot,
    team: plan.team.map((entry) => ({ ...entry })),
    targets: [...raid.targets],
    raidName: raid.name,
  }
}

export function hasDraftChanges(state, plan) {
  const published = getWeek(state, state.currentWeek).plan?.published
  if (!published) return true
  const { publishedAt: _time, ...saved } = published
  return stableJson(snapshot(state, plan)) !== stableJson(saved)
}

/** Changes visible to players, ignoring internal locks and attendance edits. */
export function publicationChanges(state, plan) {
  const previous = getWeek(state, state.currentWeek).plan?.published
  if (!previous) return [{ kind: 'new', message: `First publication · ${plan.team.length} players` }]
  const changes = []
  const raid = getRaid(state)
  if (previous.start !== plan.start || previous.end !== plan.end)
    changes.push({ kind: 'time', before: previous, after: plan })
  if (previous.raidName !== raid.name) changes.push({ kind: 'name', message: `Raid renamed to ${raid.name}` })
  if (stableJson(previous.targets) !== stableJson(raid.targets))
    changes.push({ kind: 'composition', message: `Role targets: ${raid.targets.join(' / ')}` })
  const description = (entry) =>
    `${characterById(state, entry.characterId)?.name ?? 'Removed character'} (${entry.role})`
  for (const entry of plan.team) {
    const before = previous.team.find((e) => e.memberId === entry.memberId)
    const name = memberById(state, entry.memberId)?.name ?? 'Removed player'
    if (!before)
      changes.push({
        kind: 'added',
        memberId: entry.memberId,
        message: `${name} added · ${description(entry)}`,
      })
    else if (before.characterId !== entry.characterId || before.role !== entry.role)
      changes.push({
        kind: 'changed',
        memberId: entry.memberId,
        message: `${name}: ${description(before)} → ${description(entry)}`,
      })
  }
  for (const entry of previous.team.filter((e) => !plan.team.some((p) => p.memberId === e.memberId)))
    changes.push({
      kind: 'removed',
      memberId: entry.memberId,
      message: `${memberById(state, entry.memberId)?.name ?? 'Removed player'} removed from roster`,
    })
  return changes
}

/** Structured publication failures let the UI take an officer straight to the affected assignment. */
export function publicationIssues(state, plan, players) {
  const issues = []
  if (!plan.team.length) issues.push({ kind: 'empty', message: 'Add players before publishing this roster.' })
  if (getWeek(state, state.currentWeek).plan?.cancelled)
    issues.push({
      kind: 'cancelled',
      message: 'A cancelled raid cannot be published. Clear its cancelled status first.',
    })
  const overlaps = overlappingPlayers(state, state.currentWeek, state.currentRaidId, plan, true)
  for (const other of overlaps)
    for (const memberId of other.memberIds)
      issues.push({
        kind: 'overlap',
        memberId,
        raidId: other.raidId,
        week: other.week,
        message: `${memberById(state, memberId)?.name ?? 'Removed player'} is already rostered for ${other.raidName}.`,
      })
  const seen = new Set()
  for (const entry of plan.team) {
    const name = memberById(state, entry.memberId)?.name ?? 'Removed player'
    if (seen.has(entry.memberId))
      issues.push({
        kind: 'duplicate',
        memberId: entry.memberId,
        message: `${name} holds more than one roster slot.`,
      })
    seen.add(entry.memberId)
    const reasons = conflicts(entry, players, plan).filter((reason) => !reason.startsWith('Committed to '))
    if (reasons.length)
      issues.push({ kind: 'player', memberId: entry.memberId, message: `${name}: ${reasons.join('; ')}.` })
  }
  const raid = getRaid(state)
  ROLES.forEach((role, i) => {
    const count = plan.team.filter((e) => e.role === role).length
    if (count > raid.targets[i])
      issues.push({
        kind: 'capacity',
        role,
        message: `${role}: ${count} players for ${raid.targets[i]} slots. Move a player to the bench.`,
      })
  })
  return issues
}

/** Publishing freezes the player-facing roster. Subsequent edits continue in a separate draft. */
export function publishPlan(state, plan, players, now = Date.now()) {
  const issues = publicationIssues(state, plan, players)
  if (issues.some((issue) => issue.kind === 'overlap'))
    return {
      state,
      error: 'Resolve overlapping players with other published raids before publishing.',
      issues,
    }
  if (!plan.team.length) return { state, error: 'Add players before publishing this roster.' }
  if (getWeek(state, state.currentWeek).plan?.cancelled)
    return { state, error: 'A cancelled raid cannot be published.' }
  if (new Set(plan.team.map((entry) => entry.memberId)).size !== plan.team.length)
    return { state, error: 'A player can only hold one roster slot.' }
  if (plan.team.some((entry) => conflicts(entry, players, plan).length))
    return {
      state,
      error: 'Resolve unavailable players, unoffered characters, and role mismatches before publishing.',
    }
  const raid = getRaid(state)
  if (
    ROLES.some((role, index) => plan.team.filter((entry) => entry.role === role).length > raid.targets[index])
  )
    return { state, error: 'The roster exceeds this raid’s role limits.' }
  if (overlappingPlayers(state, state.currentWeek, state.currentRaidId, plan, true).length)
    return { state, error: 'Resolve overlapping players with other published raids before publishing.' }
  const next = setPlan(state, state.currentWeek, plan)
  return {
    state: updateWeek(next, state.currentWeek, (week) => ({
      ...week,
      plans: {
        ...week.plans,
        [state.currentRaidId]: {
          ...week.plans[state.currentRaidId],
          published: { ...snapshot(state, plan), publishedAt: now },
        },
      },
    })),
  }
}

export function withdrawPlan(state) {
  const raidId = state.currentRaidId
  if (!getWeek(state, state.currentWeek).plan?.published) return state
  return updateWeek(state, state.currentWeek, (week) => ({
    ...week,
    plans: { ...week.plans, [raidId]: { ...week.plans[raidId], published: null } },
  }))
}

/** Restore only the changed plan, preserving other weeks, preferences, and viewer navigation. */
export function undoRosterChange(state, change) {
  if (
    !change ||
    stableJson(state.weeks[change.week]?.plans[change.raidId] ?? null) !== stableJson(change.after)
  )
    return { state, error: 'Can’t undo: this roster has changed since.' }
  return {
    state: updateWeek(state, change.week, (week) => {
      const plans = { ...week.plans }
      if (change.before) plans[change.raidId] = change.before
      else delete plans[change.raidId]
      return { ...week, plans }
    }),
  }
}

export function copyPreviousRoster(state) {
  const last = getWeek(state, addDays(state.currentWeek, -7)).plan
  if (!last || last.cancelled)
    return { state, error: 'There is no roster to copy from last week for this raid.' }
  const source = last.published ?? last
  const raid = getRaid(state)
  const current = getWeek(state, state.currentWeek).plan
  const clock = wallTime(source.start, state.guild.timezone)
  // Overnight sessions belong to the previous grid day when their clock time is before the day start.
  const overnight = clock.minutes < state.guild.dayStartHour * 60
  const day = (weekdayIndex(clock.dateIso) + (overnight ? 6 : 0)) % 7
  const slot = clampStartSlot(
    (clock.minutes + (overnight ? 1440 : 0) - state.guild.dayStartHour * 60) / 30,
    raid.durationSlots,
    state.guild,
  )
  const start =
    current?.start ?? slotWindow(state.currentWeek, day, slot, raid.durationSlots, state.guild).start
  const team = []
  for (const entry of source.team) {
    const character = characterById(state, entry.characterId)
    const roleIndex = ROLES.indexOf(entry.role)
    if (
      !character ||
      character.memberId !== entry.memberId ||
      roleIndex < 0 ||
      team.some((e) => e.memberId === entry.memberId)
    )
      continue
    if (team.filter((e) => e.role === entry.role).length < raid.targets[roleIndex]) team.push({ ...entry })
  }
  return {
    state: setPlan(state, state.currentWeek, { start, team, locked: [], attendance: {}, cancelled: false }),
    dropped: source.team.length - team.length,
  }
}

/** Explain observable eligibility and roster facts without claiming a manual choice was made by the optimizer. */
export function rosterExplanation(state, plan, players, memberId) {
  const player = players.find((p) => p.id === memberId)
  if (!player) return []
  const entry = plan.team.find((e) => e.memberId === memberId)
  const preference = getCheckin(state, state.currentWeek, memberId).raids?.[state.currentRaidId]
  const lines = []
  if (preference?.participating === false) lines.push('Opted out of this raid for the week.')
  else if (!player.checkedIn) lines.push('Has not checked in for this week.')
  else if (!isAvailable(player, plan)) lines.push('Cannot stay for this entire session.')
  else if (!player.characters.some((c) => c.offered)) lines.push('No characters offered for this raid.')
  else lines.push('Available for the full session and offering an eligible character.')
  if (entry) {
    const character = characterById(state, entry.characterId)
    lines.push(
      `Fills a ${entry.role} slot on ${character?.name ?? 'a missing character'}${character?.main ? ' (main)' : ' (alt)'}.`,
    )
    if (plan.locked?.includes(memberId)) lines.push('Officer-locked: kept through roster rebuilds.')
    lines.push(...conflicts(entry, players, plan))
  } else if (isAvailable(player, plan) && player.characters.some((c) => c.offered)) {
    const targets = plan.targets ?? getRaid(state).targets
    const open = ROLES.filter(
      (role, i) =>
        player.characters.some((c) => c.offered && c.role === role) &&
        plan.team.filter((e) => e.role === role).length < targets[i],
    )
    lines.push(
      open.length
        ? `Could fill an open ${open.join(' / ')} slot; rebuild or add them manually.`
        : 'Their offered roles are filled on the current roster; they are available as a backup.',
    )
  }
  lines.push(
    `Recent bench priority: ${player.priority ?? 0} eligible sit-outs in the last 4 weeks for this raid.`,
  )
  return lines
}
