<script>
  import { DAYS } from '../lib/constants.js'
  import { displayZone } from '../lib/display.svelte.js'
  import { formatRowLabel, slotWindow } from '../lib/grid.js'
  import { exactSessionLabel } from '../lib/personal-raids.js'
  import { addDays, dayOfMonth } from '../lib/time.js'

  /**
   * Day headers and time labels; the caller renders each cell through the `cell(day, slot)` snippet.
   * Columns are the guild's days. Row labels follow the viewer's chosen timezone, marked +1 when a
   * row falls on the next day (after midnight, or ahead in the viewer's zone).
   * `dayHead(day)` optionally replaces the plain day headers.
   */
  let { weekIso, grid, cell, dayHead = null } = $props()

  const zone = $derived(displayZone(grid))

  const slots = $derived(Array.from({ length: grid.slotsPerDay }, (_, i) => i))
</script>

<div class="heatmap">
  <span></span>
  {#each DAYS as dayName, day (dayName)}
    {#if dayHead}
      {@render dayHead(day)}
    {:else}
      <div class="day" title={exactSessionLabel(slotWindow(weekIso, day, 0, grid.slotsPerDay, grid), zone)}>
        {dayName.toUpperCase()}<small>{dayOfMonth(addDays(weekIso, day))}</small>
      </div>
    {/if}
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
