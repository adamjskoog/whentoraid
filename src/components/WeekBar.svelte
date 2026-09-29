<script>
  import { app } from '../lib/app.svelte.js'
  import { formatSlot } from '../lib/grid.js'
  import { setCurrentWeek } from '../lib/model.js'
  import { addDays, formatMonthDay, mondayOf, todayIso } from '../lib/time.js'

  const DAYS_PER_WEEK = 7

  const guild = $derived(app.data.guild)
  const weekIso = $derived(app.data.currentWeek)
  const thisWeek = $derived(mondayOf(todayIso(guild.timezone)))
  const hoursLabel = $derived(`${formatSlot(0, guild)}–${formatSlot(guild.slotsPerDay, guild)}`)

  function goTo(dateIso) {
    app.data = setCurrentWeek(app.data, dateIso)
  }

  function changeWeek(event) {
    const input = event.currentTarget
    goTo(input.value)
    // Picking a mid-week date snaps to Monday; show the snapped date even if the week did not change.
    input.value = app.data.currentWeek
  }
</script>

<div class="weekbar">
  <div class="week-nav" role="group" aria-label="Choose week">
    <button
      aria-label="Previous week, {formatMonthDay(addDays(weekIso, -DAYS_PER_WEEK))}"
      onclick={() => goTo(addDays(weekIso, -DAYS_PER_WEEK))}>‹</button
    >
    <label class="field">
      Week beginning
      <input type="date" value={weekIso} onchange={changeWeek} />
    </label>
    <button
      aria-label="Next week, {formatMonthDay(addDays(weekIso, DAYS_PER_WEEK))}"
      onclick={() => goTo(addDays(weekIso, DAYS_PER_WEEK))}>›</button
    >
    <button disabled={weekIso === thisWeek} onclick={() => goTo(thisWeek)}>This week</button>
  </div>
  <span class="badge">WOW: FOREVER</span>
  <small class="right">All times: {guild.timezone} · {hoursLabel} · 30-minute slots</small>
</div>
