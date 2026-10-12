<script>
  import AvailabilityGrid from '../components/AvailabilityGrid.svelte'
  import AvailabilityRanges from '../components/AvailabilityRanges.svelte'
  import InlineSaveStatus from '../components/InlineSaveStatus.svelte'
  import OnboardingChecklist from '../components/OnboardingChecklist.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import WeekBar from '../components/WeekBar.svelte'
  import RaidSelector from '../components/RaidSelector.svelte'
  import { getRaid } from '../lib/raids.js'
  import { app } from '../lib/app.svelte.js'
  import { templateFor } from '../lib/availability-template.js'
  import { changesClosedWeek, checkinsClosed } from '../lib/checkins.js'
  import { own } from '../lib/ids.js'
  import { stableJson } from '../lib/remote/rows.js'
  import { canManage } from '../lib/remote/sync.svelte.js'
  import { CLASS_COLORS } from '../lib/constants.js'
  import { availabilitySource } from '../lib/personal-raids.js'
  import {
    charactersOf,
    getCheckin,
    getWeek,
    isOfferingAny,
    isOffered,
    markUnavailable,
    restoreCheckin,
    setCharacterOffered,
    setSlotAvailable,
    setRaidParticipation,
    saveAvailabilityTemplate,
    removeAvailabilityTemplate,
    useAvailabilityTemplate,
  } from '../lib/model.js'
  import { showToast, offerUndo } from '../lib/toast.svelte.js'

  const memberId = $derived(app.data.currentMemberId)
  let editor = $state(globalThis.matchMedia?.('(max-width: 600px)').matches ? 'ranges' : 'grid')
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
    if (checkin.ranges.length === 0) return 'Checked in · not available this week'
    return 'Checked in · changes save automatically and count right away'
  })

  function paint(interval, available) {
    if (closed) return
    app.data = setSlotAvailable(app.data, weekIso, memberId, interval, available)
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

<div class="availability-layout">
  <div class="panel" inert={closed}>
    <h2>Weekly availability</h2>
    <p>
      These times apply to {app.data.settings.raids.length === 1
        ? 'your raid'
        : `all ${app.data.settings.raids.length} raids`}. Adjust any week without changing your usual
      schedule.
    </p>
    <span class="badge">{availabilitySource(app.data, weekIso, memberId)}</span>
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
    <div class="buttons editor-choice" role="group" aria-label="Availability editor">
      <button aria-pressed={editor === 'ranges'} onclick={() => (editor = 'ranges')}>Time ranges</button>
      <button aria-pressed={editor === 'grid'} onclick={() => (editor = 'grid')}>Paint grid</button>
    </div>
    {#if editor === 'ranges'}
      <AvailabilityRanges
        {weekIso}
        grid={app.data.guild}
        ranges={checkin.ranges}
        onpaint={paint}
        oneditstart={beginEdit}
        oneditend={endEdit}
      />
    {:else}
      <AvailabilityGrid
        {weekIso}
        grid={app.data.guild}
        ranges={checkin.ranges}
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

  <div>
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
</style>
