<script>
  import AvailabilityGrid from '../components/AvailabilityGrid.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import WeekBar from '../components/WeekBar.svelte'
  import { app } from '../lib/app.svelte.js'
  import { CLASS_COLORS } from '../lib/constants.js'
  import {
    charactersOf,
    getCheckin,
    isOfferingAny,
    isOffered,
    markUnavailable,
    setCharacterOffered,
    setSlotAvailable,
  } from '../lib/model.js'
  import { showToast } from '../lib/toast.svelte.js'

  const memberId = $derived(app.data.currentMemberId)
  const weekIso = $derived(app.data.currentWeek)
  const checkin = $derived(getCheckin(app.data, weekIso, memberId))
  const myCharacters = $derived(charactersOf(app.data, memberId))
  const offeringAny = $derived(isOfferingAny(app.data, weekIso, memberId))

  const status = $derived.by(() => {
    if (!checkin.checkedIn) return 'Not checked in yet · mark your times and they save automatically'
    if (checkin.ranges.length === 0) return 'Checked in · not available this week'
    return 'Checked in · changes save automatically and count right away'
  })

  function paint(interval, available) {
    app.data = setSlotAvailable(app.data, weekIso, memberId, interval, available)
  }

  function toggleOffered(characterId, offered) {
    app.data = setCharacterOffered(app.data, weekIso, memberId, characterId, offered)
  }

  function cantMakeIt() {
    app.data = markUnavailable(app.data, weekIso, memberId)
    showToast('Marked as not available this week')
  }
</script>

<PageTitle
  eyebrow="YOUR WEEK, YOUR WAY"
  title="When can you raid?"
  subtitle="Mark the times you can stay for the entire session."
/>

<WeekBar />

<div class="availability-layout">
  <div class="panel">
    <AvailabilityGrid {weekIso} grid={app.data.guild} ranges={checkin.ranges} onpaint={paint} />
    <div class="buttons form-actions">
      <button onclick={cantMakeIt}>Can’t make it this week</button>
      <small role="status">{status}</small>
    </div>
  </div>

  <div>
    <h2>Who are you bringing?</h2>
    <p>Offer every character you would enjoy playing this week. You will only fill one raid slot.</p>
    {#each myCharacters as character (character.id)}
      <div class="character-card" style:--class={CLASS_COLORS[character.class]}>
        <strong>{character.name}</strong>
        <small>{character.spec} {character.class} · {character.role}</small>
        <label>
          <input
            type="checkbox"
            checked={isOffered(checkin, character.id)}
            onchange={(e) => toggleOffered(character.id, e.currentTarget.checked)}
          />
          Available to raid this week
        </label>
      </div>
    {/each}
    {#if !offeringAny}
      <p class="note warning">
        You aren’t offering any characters this week, so the planner can’t place you.
      </p>
    {/if}
    <p class="note">Availability is specific to this week. New weeks start empty.</p>
  </div>
</div>
