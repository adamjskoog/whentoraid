<script>
  import { DAYS } from '../lib/constants.js'
  import { formatSlot } from '../lib/grid.js'
  import { addDays, dayOfMonth } from '../lib/time.js'

  /** Day headers and time labels; the caller renders each cell through the `cell(day, slot)` snippet. */
  let { weekIso, grid, cell } = $props()

  const slots = $derived(Array.from({ length: grid.slotsPerDay }, (_, i) => i))
</script>

<div class="heatmap">
  <span></span>
  {#each DAYS as dayName, day (dayName)}
    <div class="day">{dayName.toUpperCase()}<small>{dayOfMonth(addDays(weekIso, day))}</small></div>
  {/each}
  {#each slots as slot (slot)}
    <div class="time">{slot % 2 === 0 ? formatSlot(slot, grid) : ''}</div>
    {#each DAYS as dayName, day (dayName)}
      {@render cell(day, slot)}
    {/each}
  {/each}
  <div class="time">{formatSlot(grid.slotsPerDay, grid)}</div>
  <span class="grid-spacer"></span>
</div>
