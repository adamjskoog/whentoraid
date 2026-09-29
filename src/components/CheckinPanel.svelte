<script>
  import { app } from '../lib/app.svelte.js'
  import { deadlineUtc, reminderDiscord, waitingOn } from '../lib/checkins.js'
  import { displayZone } from '../lib/display.svelte.js'

  /** Who still has to answer this week, the deadline, and a Discord reminder to copy. */
  let { oncopy } = $props()

  const weekIso = $derived(app.data.currentWeek)
  const missing = $derived(waitingOn(app.data, weekIso))
  const deadline = $derived(deadlineUtc(app.data, weekIso))
  const deadlineLabel = $derived(
    deadline === null
      ? null
      : new Date(deadline).toLocaleString('en-US', {
          timeZone: displayZone(app.data.guild),
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }),
  )
  /** Re-checked every minute so "passed" appears without any other change on the page. */
  const CLOCK_TICK_MS = 60_000
  let now = $state(Date.now())
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  })
  const passed = $derived(deadline !== null && now > deadline)

  function copyReminder() {
    const text = reminderDiscord(app.data, weekIso)
    if (text) oncopy(text, 'Reminder copied. Paste it into Discord.')
  }
</script>

<section class="panel side-section" aria-labelledby="checkin-heading">
  <span class="eyebrow gold">CHECK-INS</span>
  <h2 id="checkin-heading" class="readiness-heading">
    {missing.length ? `Waiting on ${missing.length}` : 'Everyone has answered'}
  </h2>
  {#if deadlineLabel}
    <p>
      Deadline: {deadlineLabel}
      {#if passed}<span class="warning inline">· passed</span>{/if}
    </p>
  {:else}
    <p>No check-in deadline set.</p>
  {/if}
  {#if missing.length}
    <ul class="name-list" aria-label="Players who have not checked in">
      {#each missing as member (member.id)}
        <li>{member.name}</li>
      {/each}
    </ul>
    <button class="full-width spaced-top" onclick={copyReminder}>Copy reminder for Discord</button>
  {/if}
</section>
