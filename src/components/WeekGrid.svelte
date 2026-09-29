<script>
  import { DAYS } from '../lib/constants.js'
  import { displayZone } from '../lib/display.svelte.js'
  import { formatRowLabel } from '../lib/grid.js'
  import { addDays, dayOfMonth } from '../lib/time.js'

  /**
   * Day headers and time labels; the caller renders each cell through the `cell(day, slot)` snippet.
   * Columns are the guild's days. Row labels follow the viewer's chosen timezone, marked +1 when a
   * row falls on the next day (after midnight, or ahead in the viewer's zone).
   */
  let { weekIso, grid, cell } = $props()

  const zone = $derived(displayZone(grid))

  const slots = $derived(Array.from({ length: grid.slotsPerDay }, (_, i) => i))
</script>

<div class="heatmap">
  <span></span>
  {#each DAYS as dayName, day (dayName)}
    <div class="day">{dayName.toUpperCase()}<small>{dayOfMonth(addDays(weekIso, day))}</small></div>
  {/each}
  {#each slots as slot (slot)}
    <div class="time">{slot % 2 === 0 ? formatRowLabel(weekIso, slot, grid, zone) : ''}</div>
    {#each DAYS as dayName, day (dayName)}
      {@render cell(day, slot)}
    {/each}
  {/each}
  <div class="time">{formatRowLabel(weekIso, grid.slotsPerDay, grid, zone)}</div>
  <span class="grid-spacer"></span>
</div>
