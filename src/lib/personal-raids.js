import { SLOT_MINUTES } from './constants.js'
import { templateFor } from './availability-template.js'
import { own } from './ids.js'
import { charactersOf, getCheckin } from './model.js'

/** Only a published snapshot is a promise to players; draft edits never change this list. */
export function personalRaids(state, memberId, now = Date.now()) {
  if (!memberId) return []
  return Object.entries(state.weeks)
    .flatMap(([weekIso, week]) =>
      state.settings.raids.flatMap((raid) => {
        const draft = own(week.plans, raid.id)
        const plan = draft?.published
        if (!plan || draft.cancelled) return []
        const end = plan.end ?? plan.start + raid.durationSlots * SLOT_MINUTES * 60_000
        if (end <= now) return []
        const assignment = plan.team.find((entry) => entry.memberId === memberId)
        return [
          {
            weekIso,
            raidId: raid.id,
            raid,
            plan,
            assignment: assignment ?? null,
            character: assignment
              ? (state.characters.find((c) => c.id === assignment.characterId) ?? null)
              : null,
            session: { start: plan.start, end },
          },
        ]
      }),
    )
    .sort((a, b) => a.session.start - b.session.start || a.raid.name.localeCompare(b.raid.name))
}

export function availabilitySource(state, weekIso, memberId) {
  if (own(state.weeks[weekIso]?.checkins, memberId)?.checkedIn) return 'Updated this week'
  if (templateFor(own(state.templates, memberId), weekIso)) return 'Using usual schedule'
  return 'No response yet'
}

/** Setup readiness is personal, and explicitly answering unavailable still completes a check-in. */
export function onboardingSteps(state, memberId, weekIso = state.currentWeek) {
  return [
    {
      id: 'joined',
      label: 'Join your guild',
      complete: state.members.some((m) => m.id === memberId),
      view: null,
    },
    {
      id: 'character',
      label: 'Add a character',
      complete: charactersOf(state, memberId).length > 0,
      view: 'characters',
    },
    {
      id: 'availability',
      label: 'Set your availability',
      complete: getCheckin(state, weekIso, memberId).checkedIn,
      view: 'availability',
    },
  ]
}

/** Full dates on both ends remove ambiguity across midnight, timezones and DST transitions. */
export function exactSessionLabel({ start, end }, zone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
  return `${formatter.format(start)} – ${formatter.format(end)}`
}
