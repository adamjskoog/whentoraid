<script>
  import { DAYS } from '../lib/constants.js'
  import { displayZone } from '../lib/display.svelte.js'
  import { formatSlotDay, slotWindow, weekSlotWindows } from '../lib/grid.js'
  import { focusCell, nextCell } from '../lib/grid-nav.js'
  import { covers } from '../lib/intervals.js'
  import { addDays, dayOfMonth } from '../lib/time.js'
  import WeekGrid from './WeekGrid.svelte'
  import { exactSessionLabel } from '../lib/personal-raids.js'

  /**
   * Click, drag, or press Space/Enter to paint availability. `onpaint(interval, available)` records it.
   * Dragging follows the pointer with elementFromPoint rather than per-cell enter events, because a
   * touch pointer stays captured by the cell it started on.
   */
  let {
    weekIso,
    grid,
    ranges,
    onpaint,
    oneditstart = () => {},
    oneditend = () => {},
    /** Shown but not painted: preferred times lie within firm ones, tentative times outside them. */
    preferredRanges = [],
    tentativeRanges = [],
    /** What painting marks, e.g. "available" or "tentative", for the cell labels. */
    kindLabel = 'available',
  } = $props()

  /** While dragging: true paints available, false erases, null means not painting. */
  let paintValue = null
  /** The last cell visited in this drag, so each cell is painted once per pass. */
  let lastCellKey = null

  const slotWindows = $derived(weekSlotWindows(weekIso, grid))
  const zone = $derived(displayZone(grid))
  let selected = $state(null)
  const selectedLabel = $derived(
    selected ? exactSessionLabel(slotWindows[selected.day][selected.slot], zone) : '',
  )

  function isMine(day, slot) {
    return covers(ranges, slotWindows[day][slot])
  }

  function paintCell(day, slot) {
    const key = `${day}:${slot}`
    if (key === lastCellKey) return
    lastCellKey = key
    selected = { day, slot }
    if (isMine(day, slot) !== paintValue) onpaint(slotWindows[day][slot], paintValue)
  }

  function cellAt(x, y) {
    const hit = document.elementFromPoint(x, y)?.closest('[data-paint-cell]')
    return hit ? { day: Number(hit.dataset.day), slot: Number(hit.dataset.slot) } : null
  }

  function beginPaint(event, day, slot) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    oneditstart()
    paintValue = !isMine(day, slot)
    lastCellKey = null
    paintCell(day, slot)
  }

  function continuePaint(event) {
    if (paintValue === null) return
    if (event.pointerType === 'mouse' && !event.buttons) return endPaint()
    const cell = cellAt(event.clientX, event.clientY)
    if (cell) paintCell(cell.day, cell.slot)
  }

  function endPaint() {
    if (paintValue === null) return
    paintValue = null
    lastCellKey = null
    oneditend()
  }

  /** A day header clears a day that has any of your times, and fills an empty one. */
  function toggleDay(day) {
    const hasAny = slotWindows[day].some((window) => covers(ranges, window))
    oneditstart()
    onpaint(slotWindow(weekIso, day, 0, grid.slotsPerDay, grid), !hasAny)
    oneditend()
  }

  /** Only one cell is a Tab stop; arrow keys move between cells (roving tabindex). */
  let focused = $state({ day: 0, slot: 0 })
  // Fall back to the first cell if the remembered one no longer exists (fewer slots per day).
  const tabStop = $derived(focused.slot < grid.slotsPerDay ? focused : { day: 0, slot: 0 })
  let container

  function handleKey(event, day, slot) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      selected = { day, slot }
      oneditstart()
      onpaint(slotWindows[day][slot], !isMine(day, slot))
      oneditend()
      return
    }
    const target = nextCell({ day, slot }, event.key, grid.slotsPerDay)
    if (!target) return
    event.preventDefault()
    focused = target
    focusCell(container, target)
  }
</script>

<svelte:window onpointermove={continuePaint} onpointerup={endPaint} onpointercancel={endPaint} />

{#snippet cell(day, slot)}
  {@const mine = isMine(day, slot)}
  {@const preferred = covers(preferredRanges, slotWindows[day][slot])}
  {@const tentative = covers(tentativeRanges, slotWindows[day][slot])}
  {@const status = mine ? kindLabel : kindLabel === 'available' ? 'unavailable' : `not ${kindLabel}`}
  {@const extra = `${preferred && kindLabel !== 'preferred' ? ', preferred' : ''}${tentative && kindLabel !== 'tentative' ? ', tentative' : ''}`}
  {@const label = `${formatSlotDay(weekIso, day, slot, grid, zone)} ${status}${extra}`}
  <button
    class="cell"
    class:mine
    class:preferred
    class:tentative
    data-paint-cell
    data-day={day}
    data-slot={slot}
    aria-pressed={mine}
    aria-label={label}
    title={label}
    tabindex={tabStop.day === day && tabStop.slot === slot ? 0 : -1}
    onfocus={() => {
      focused = { day, slot }
      selected = { day, slot }
    }}
    onpointerdown={(e) => beginPaint(e, day, slot)}
    onkeydown={(e) => handleKey(e, day, slot)}
  ></button>
{/snippet}

{#snippet dayHead(day)}
  {@const hasAny = slotWindows[day].some((window) => covers(ranges, window))}
  <button
    class="day day-toggle"
    aria-label="Mark {DAYS[day]} {hasAny ? 'unavailable' : 'available'}"
    title={hasAny ? 'Clear this whole day' : 'Mark this whole day available'}
    onclick={() => toggleDay(day)}
    >{DAYS[day].toUpperCase()}<small>{dayOfMonth(addDays(weekIso, day))}</small></button
  >
{/snippet}

<div bind:this={container}>
  <WeekGrid {weekIso} {grid} {cell} {dayHead} />
</div>
<p class="selected-time" aria-live="polite">
  {selectedLabel || 'Select a time to see its full date and local time.'}
</p>
<div class="legend">
  <span
    >Click or drag to mark your availability. Click a day to clear it, or to fill an empty one. Keyboard:
    arrow keys to move, Space to toggle.</span
  >
  <span>■ Available</span>
  {#if preferredRanges.length || kindLabel === 'preferred'}<span class="key preferred">■ Preferred</span>{/if}
  {#if tentativeRanges.length || kindLabel === 'tentative'}<span class="key tentative">■ Tentative</span>{/if}
</div>

<style>
  .cell.preferred {
    box-shadow: inset 0 0 0 2px var(--gold, #d4af37);
  }
  .cell.tentative {
    background-image: repeating-linear-gradient(
      45deg,
      transparent 0 4px,
      color-mix(in srgb, var(--gold, #d4af37) 45%, transparent) 4px 6px
    );
  }
  .key.preferred {
    color: var(--gold, #d4af37);
  }
  .key.tentative {
    opacity: 0.85;
    font-style: italic;
  }
</style>
