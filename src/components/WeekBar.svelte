<script>
  import { app } from '../lib/app.svelte.js'
  import { setCurrentWeek } from '../lib/model.js'

  function changeWeek(event) {
    const input = event.currentTarget
    app.data = setCurrentWeek(app.data, input.value)
    // Picking a mid-week date snaps to Monday; show the snapped date even if the week did not change.
    input.value = app.data.currentWeek
  }
</script>

<div class="weekbar">
  <label class="field">
    Week beginning
    <input type="date" value={app.data.currentWeek} onchange={changeWeek} />
  </label>
  <span class="badge">WOW: FOREVER</span>
  <small class="right">All times: {app.data.guild.timezone} · Noon–midnight · 30-minute slots</small>
</div>
