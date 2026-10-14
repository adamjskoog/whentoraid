<script>
  import AvailabilityGrid from '../components/AvailabilityGrid.svelte'
  import AvailabilityRanges from '../components/AvailabilityRanges.svelte'
  import InlineSaveStatus from '../components/InlineSaveStatus.svelte'
  import OnboardingChecklist from '../components/OnboardingChecklist.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import WeekBar from '../components/WeekBar.svelte'
  import RaidSelector from '../components/RaidSelector.svelte'
  import SectionTabs from '../components/SectionTabs.svelte'
  import { getRaid } from '../lib/raids.js'
  import { app } from '../lib/app.svelte.js'
  import { templateFor } from '../lib/availability-template.js'
  import { changesClosedWeek, checkinsClosed } from '../lib/checkins.js'
  import { own } from '../lib/ids.js'
  import { stableJson } from '../lib/remote/rows.js'
  import { canManage } from '../lib/remote/sync.svelte.js'
  import { CLASS_COLORS } from '../lib/constants.js'
  import { availabilitySource } from '../lib/personal-raids.js'
  import { slotWindow } from '../lib/grid.js'
  import { addDays, daysBetween, formatMonthDay, mondayOf } from '../lib/time.js'
  import {
    charactersOf,
    getCheckin,
    getWeek,
    isOfferingAny,
    isOffered,
    markUnavailable,
    restoreCheckin,
    setAbsenceDates,
    setAvailabilityKind,
    setCharacterOffered,
    setRaidParticipation,
    upcomingAbsences,
    saveAvailabilityTemplate,
    removeAvailabilityTemplate,
    useAvailabilityTemplate,
  } from '../lib/model.js'
  import { showToast, offerUndo } from '../lib/toast.svelte.js'

  const memberId = $derived(app.data.currentMemberId)
  let editor = $state(globalThis.matchMedia?.('(max-width: 600px)').matches ? 'ranges' : 'grid')
  let mobileSection = $state('times')
  let beforeEdit = null
  const weekIso = $derived(app.data.currentWeek)
  const checkin = $derived(getCheckin(app.data, weekIso, memberId))
  const myCharacters = $derived(charactersOf(app.data, memberId))
  const offeringAny = $derived(isOfferingAny(app.data, weekIso, memberId))
  const raid = $derived(getRaid(app.data))
  const participating = $derived(checkin.raids?.[raid.id]?.participating !== false)
  const template = $derived(own(app.data.templates, memberId))
  const usingTemplate = $derived(
    templateFor(template, weekIso) !== null && !own(app.data.weeks[weekIso]?.checkins, memberId),
  )

  /** Re-checked every minute, so the page locks when the deadline passes while it is open. */
  const CLOCK_TICK_MS = 60_000
  let now = $state(Date.now())
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  })
  /** Online players cannot change a week after its check-in deadline; officers still can. */
  const closed = $derived(!canManage() && checkinsClosed(app.data, weekIso, now))

  function changeTemplate(action) {
    const previous = app.data
    const next =
      action === 'save'
        ? saveAvailabilityTemplate(app.data, weekIso, memberId)
        : action === 'remove'
          ? removeAvailabilityTemplate(app.data, memberId)
          : useAvailabilityTemplate(app.data, weekIso, memberId)
    if (!canManage() && changesClosedWeek(previous, next, memberId)) {
      showToast(
        'This week’s check-ins have closed and your usual schedule fills them in. Change it from next week instead.',
      )
      return
    }
    app.data = next
    offerUndo(
      action === 'save'
        ? 'Usual schedule saved for new weeks.'
        : action === 'remove'
          ? 'Usual schedule removed. Saved weeks are unchanged.'
          : 'Usual schedule applied to this week.',
      previous,
    )
  }

  const status = $derived.by(() => {
    if (!checkin.checkedIn) return 'Not checked in yet · mark your times and they save automatically'
    if (checkin.ranges.length === 0 && checkin.tentativeRanges?.length)
      return 'Checked in · only tentative times this week'
    if (checkin.ranges.length === 0) return 'Checked in · not available this week'
    return 'Checked in · changes save automatically and count right away'
  })

  /** What painting marks. Preferred times are firm; tentative times never count as firm. */
  let kind = $state('firm')
  const KIND_LABELS = { firm: 'available', preferred: 'preferred', tentative: 'tentative' }
  const kindRanges = $derived(
    kind === 'preferred'
      ? (checkin.preferredRanges ?? [])
      : kind === 'tentative'
        ? (checkin.tentativeRanges ?? [])
        : checkin.ranges,
  )

  /** Guild days this week the player marked themselves away. */
  const awayWindows = $derived(
    (checkin.absentDates ?? []).map((dateIso) =>
      slotWindow(weekIso, daysBetween(weekIso, dateIso), 0, app.data.guild.slotsPerDay, app.data.guild),
    ),
  )

  function paint(interval, available) {
    if (closed) return
    if (awayWindows.some((away) => away.start < interval.end && interval.start < away.end)) {
      showToast('You are marked away that day. Remove the away dates first.')
      return
    }
    app.data = setAvailabilityKind(app.data, weekIso, memberId, interval, kind, available)
  }

  let awayFrom = $state('')
  let awayTo = $state('')
  const absences = $derived(upcomingAbsences(app.data, memberId, now))

  /** A player cannot change a week whose check-ins have closed; officers can. */
  function closedWeekIn(fromIso, toIso) {
    if (canManage()) return null
    for (let week = mondayOf(fromIso); week <= toIso; week = addDays(week, 7)) {
      if (checkinsClosed(app.data, week, now)) return week
    }
    return null
  }

  function changeAbsence(fromIso, toIso, away) {
    const closedWeek = closedWeekIn(fromIso, toIso)
    if (closedWeek) {
      showToast(
        `Check-ins for the week of ${formatMonthDay(closedWeek)} have closed. Ask an officer to change it.`,
      )
      return false
    }
    const previous = app.data
    const result = setAbsenceDates(app.data, memberId, fromIso, toIso, away)
    if (result.error) {
      showToast(result.error)
      return false
    }
    app.data = result.state
    offerUndo(away ? 'Away dates saved. Your times are kept underneath.' : 'Away dates removed.', previous)
    return true
  }

  function addAbsence(event) {
    event.preventDefault()
    if (changeAbsence(awayFrom, awayTo || awayFrom, true)) awayFrom = awayTo = ''
  }

  function beginEdit() {
    beforeEdit = app.data
  }

  function endEdit() {
    if (beforeEdit && beforeEdit !== app.data) offerCheckinUndo('Availability updated.', beforeEdit)
    beforeEdit = null
  }

  /**
   * Undo only this player's check-in for the week, so edits by other people that arrived
   * meanwhile (in an online guild) are kept rather than blocking or being reverted.
   */
  function offerCheckinUndo(message, previous) {
    const week = weekIso
    const member = memberId
    const saved = (state) => own(getWeek(state, week).checkins, member)
    const before = saved(previous)
    const after = saved(app.data)
    showToast(message, {
      label: 'Undo',
      run: () => {
        if (stableJson(saved(app.data)) !== stableJson(after)) {
          showToast('Can’t undo: your availability has changed since.')
          return
        }
        app.data = restoreCheckin(app.data, week, member, before)
        showToast('Undone.')
      },
    })
  }

  function toggleOffered(characterId, offered) {
    app.data = setCharacterOffered(app.data, weekIso, memberId, characterId, offered)
  }

  function cantMakeIt() {
    if (closed) return
    const previous = app.data
    app.data = markUnavailable(app.data, weekIso, memberId)
    offerCheckinUndo('Marked as not available this week', previous)
  }
</script>

<PageTitle
  eyebrow="YOUR WEEK, YOUR WAY"
  title="When can you raid?"
  subtitle="Mark the times you can stay for the entire session."
/>

<WeekBar />

{#if !myCharacters.length || !checkin.checkedIn}
  <OnboardingChecklist {memberId} {weekIso} />
{/if}

{#if closed}
  <p class="note warning" role="status">
    Check-ins for this week closed at the deadline. Ask an officer if your times or characters need to change.
  </p>
{/if}

<div class="mobile-availability-tabs">
  <SectionTabs
    id="availability"
    label="Your check-in"
    tabs={[
      { id: 'times', label: 'Your times' },
      { id: 'characters', label: 'Raid & characters' },
    ]}
    value={mobileSection}
    onselect={(value) => (mobileSection = value)}
  />
</div>
<div class="availability-layout" data-mobile-section={mobileSection}>
  <div
    class="panel availability-times"
    id="availability-panel-times"
    role="tabpanel"
    aria-labelledby="availability-tab-times"
    inert={closed}
  >
    <h2>Weekly availability</h2>
    <p>
      Your times apply to {app.data.settings.raids.length === 1
        ? 'your raid'
        : `all ${app.data.settings.raids.length} raids`}.
    </p>
    <span class="badge">{availabilitySource(app.data, weekIso, memberId)}</span>
    <details class="usual-schedule">
      <summary>Usual schedule</summary>
      <div class="buttons">
        <button onclick={() => changeTemplate('save')}>Save as usual schedule</button>
        {#if template}
          <button disabled={templateFor(template, weekIso) === null} onclick={() => changeTemplate('use')}
            >Use usual schedule this week</button
          >
          <button onclick={() => changeTemplate('remove')}>Remove usual schedule</button>
        {/if}
      </div>
      {#if template}
        <p class="note">
          Usual schedule saved in {template.timezone}, from week of {template.fromWeek}. {usingTemplate
            ? 'This week uses it automatically.'
            : 'Saved weekly check-ins override it.'}
        </p>
      {/if}
    </details>
    <details class="usual-schedule">
      <summary>Away dates{absences.length ? ` (${absences.length})` : ''}</summary>
      <p class="note">
        Going on holiday? Mark the days you are away. Your usual times stay saved and come back afterwards.
      </p>
      <form class="away-form" onsubmit={addAbsence}>
        <label class="field">From<input type="date" required bind:value={awayFrom} /></label>
        <label class="field">To<input type="date" min={awayFrom} bind:value={awayTo} /></label>
        <button>Mark away</button>
      </form>
      {#if absences.length}
        <ul class="away-list">
          {#each absences as span (span.from)}
            <li>
              <span
                >{formatMonthDay(span.from)}{span.to !== span.from
                  ? ` – ${formatMonthDay(span.to)}`
                  : ''}</span
              >
              <button onclick={() => changeAbsence(span.from, span.to, false)}>Remove</button>
            </li>
          {/each}
        </ul>
      {/if}
    </details>
    {#if checkin.absentDates?.length}
      <p class="note" role="status">
        Away this week: {checkin.absentDates.map((date) => formatMonthDay(date)).join(', ')}.
      </p>
    {/if}
    <div class="buttons editor-choice" role="group" aria-label="Availability editor">
      <button aria-pressed={editor === 'ranges'} onclick={() => (editor = 'ranges')}>Time ranges</button>
      <button aria-pressed={editor === 'grid'} onclick={() => (editor = 'grid')}>Paint grid</button>
    </div>
    <div class="buttons kind-choice" role="group" aria-label="Mark times as">
      <span>Mark as:</span>
      <button aria-pressed={kind === 'firm'} onclick={() => (kind = 'firm')}>Available</button>
      <button aria-pressed={kind === 'preferred'} onclick={() => (kind = 'preferred')}>Preferred</button>
      <button aria-pressed={kind === 'tentative'} onclick={() => (kind = 'tentative')}>Tentative</button>
    </div>
    {#if kind !== 'firm'}
      <p class="note">
        {kind === 'preferred'
          ? 'Preferred times are times you can definitely make and would most like to raid.'
          : 'Tentative times are maybes. Officers see them, but you are only rostered there if they confirm with you.'}
      </p>
    {/if}
    {#if editor === 'ranges'}
      <AvailabilityRanges
        {weekIso}
        grid={app.data.guild}
        ranges={kindRanges}
        onpaint={paint}
        oneditstart={beginEdit}
        oneditend={endEdit}
      />
    {:else}
      <AvailabilityGrid
        {weekIso}
        grid={app.data.guild}
        ranges={kindRanges}
        preferredRanges={checkin.preferredRanges ?? []}
        tentativeRanges={checkin.tentativeRanges ?? []}
        kindLabel={KIND_LABELS[kind]}
        onpaint={paint}
        oneditstart={beginEdit}
        oneditend={endEdit}
      />
    {/if}
    <div class="buttons form-actions">
      <button onclick={cantMakeIt}>Can’t make it this week</button>
      <small role="status">{status}</small>
    </div>
    <InlineSaveStatus />
  </div>

  <div
    class="availability-characters"
    id="availability-panel-characters"
    role="tabpanel"
    aria-labelledby="availability-tab-characters"
  >
    <h2>Who are you bringing?</h2>
    {#if !myCharacters.length}
      <p class="note warning">Add a character before officers can include you in a roster.</p>
      <button onclick={() => (app.view = 'characters')}>Add my first character</button>
    {/if}
    <RaidSelector />
    <fieldset class="plain" disabled={closed}>
      <label class="checkbox-row"
        ><input
          type="checkbox"
          checked={participating}
          onchange={(e) =>
            (app.data = setRaidParticipation(app.data, weekIso, memberId, raid.id, e.currentTarget.checked))}
        />Participate in {raid.name} this week</label
      >
      <p>Choose characters for {raid.name}. Your other raid choices stay separate.</p>
      {#each myCharacters as character (character.id)}
        <div class="character-card" style:--class={CLASS_COLORS[character.class]}>
          <strong>{character.name}</strong>
          <small>{character.spec} {character.class} · {character.role}</small>
          <label>
            <input
              type="checkbox"
              checked={isOffered(checkin, character.id, raid.id)}
              disabled={!participating}
              onchange={(e) => toggleOffered(character.id, e.currentTarget.checked)}
            />
            Offer {character.name} for {raid.name}
          </label>
        </div>
      {/each}
    </fieldset>
    {#if !offeringAny}
      <p class="note warning">
        You aren’t offering any characters this week, so the planner can’t place you.
      </p>
    {/if}
    <p class="note">
      New weeks use your usual schedule when saved. Raid and character choices are specific to each week.
    </p>
  </div>
</div>

<style>
  .editor-choice {
    margin: 1rem 0;
  }
  .kind-choice {
    align-items: center;
    margin: 0 0 1rem;
  }
  .away-form {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: end;
  }
  .away-list {
    list-style: none;
    padding: 0;
  }
  .away-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.25rem 0;
  }
</style>
