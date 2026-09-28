<script>
  import { DAYS } from '../lib/constants.js'
  import { isAvailable } from '../lib/engine.js'
  import { formatSlot } from '../lib/grid.js'
  import WeekGrid from './WeekGrid.svelte'

  /**
   * Each cell shows how many players could stay for a full session starting there, which is
   * what the planner ranks. Cells too late in the day to start a session show "–".
   */
  let { weekIso, grid, players, windows, selection, durationSlots, onselect } = $props()

  // Shade and text interpolate from an empty cell to a full-guild cell.
  const EMPTY_RGB = [28, 38, 29]
  const FULL_RGB = [112, 164, 98]
  const DARK_TEXT_FROM = 0.6

  const eligible = $derived(players.filter((p) => p.checkedIn && p.characters.some((c) => c.offered)))
  const startCounts = $derived(
    new Map(
      windows.map((w) => [`${w.day}:${w.startSlot}`, eligible.filter((p) => isAvailable(p, w)).length]),
    ),
  )

  function share(count) {
    return players.length ? count / players.length : 0
  }

  function heatColor(count) {
    const t = share(count)
    const channel = (i) => Math.round(EMPTY_RGB[i] + (FULL_RGB[i] - EMPTY_RGB[i]) * t)
    return `rgb(${channel(0)},${channel(1)},${channel(2)})`
  }

  function isChosen(day, slot) {
    return day === selection.day && slot >= selection.startSlot && slot < selection.startSlot + durationSlots
  }
</script>

{#snippet cell(day, slot)}
  {@const count = startCounts.get(`${day}:${slot}`)}
  {@const canStart = count !== undefined}
  {@const label = canStart
    ? `${DAYS[day]} ${formatSlot(slot, grid)} start · ${count} of ${players.length} can stay the full session`
    : `${DAYS[day]} ${formatSlot(slot, grid)} · too late to start a full session`}
  <button
    class="cell"
    class:chosen={isChosen(day, slot)}
    class:no-start={!canStart}
    class:dark-text={canStart && share(count) >= DARK_TEXT_FROM}
    style:background={canStart ? heatColor(count) : null}
    aria-label={label}
    title={label}
    onclick={() => onselect(day, slot)}>{canStart ? count || '·' : '–'}</button
  >
{/snippet}

<WeekGrid {weekIso} {grid} {cell} />
<div class="legend">
  <span>Number = players who can stay for a full session starting then. Click to move the roster.</span>
  <span>Fewer <i></i> More</span>
</div>
