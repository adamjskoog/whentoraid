<script>
  import { displayZone } from '../lib/display.svelte.js'
  import { formatSlotDay, weekSlotWindows } from '../lib/grid.js'
  import { focusCell, nextCell } from '../lib/grid-nav.js'
  import { covers } from '../lib/intervals.js'
  import WeekGrid from './WeekGrid.svelte'

  /**
   * Click, drag, or press Space/Enter to paint availability. `onpaint(interval, available)` records it.
   * Dragging follows the pointer with elementFromPoint rather than per-cell enter events, because a
   * touch pointer stays captured by the cell it started on.
   */
  let { weekIso, grid, ranges, onpaint } = $props()

  /** While dragging: true paints available, false erases, null means not painting. */
  let paintValue = null
  /** The last cell visited in this drag, so each cell is painted once per pass. */
  let lastCellKey = null

  const slotWindows = $derived(weekSlotWindows(weekIso, grid))
  const zone = $derived(displayZone(grid))

  function isMine(day, slot) {
    return covers(ranges, slotWindows[day][slot])
  }

  function paintCell(day, slot) {
    const key = `${day}:${slot}`
    if (key === lastCellKey) return
    lastCellKey = key
    if (isMine(day, slot) !== paintValue) onpaint(slotWindows[day][slot], paintValue)
  }

  function cellAt(x, y) {
    const hit = document.elementFromPoint(x, y)?.closest('[data-paint-cell]')
    return hit ? { day: Number(hit.dataset.day), slot: Number(hit.dataset.slot) } : null
  }

  function beginPaint(event, day, slot) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
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
    paintValue = null
    lastCellKey = null
  }

  /** Only one cell is a Tab stop; arrow keys move between cells (roving tabindex). */
  let focused = $state({ day: 0, slot: 0 })
  // Fall back to the first cell if the remembered one no longer exists (fewer slots per day).
  const tabStop = $derived(focused.slot < grid.slotsPerDay ? focused : { day: 0, slot: 0 })
  let container

  function handleKey(event, day, slot) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      onpaint(slotWindows[day][slot], !isMine(day, slot))
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
  {@const label = `${formatSlotDay(weekIso, day, slot, grid, zone)} ${mine ? 'available' : 'unavailable'}`}
  <button
    class="cell"
    class:mine
    data-paint-cell
    data-day={day}
    data-slot={slot}
    aria-pressed={mine}
    aria-label={label}
    title={label}
    tabindex={tabStop.day === day && tabStop.slot === slot ? 0 : -1}
    onfocus={() => (focused = { day, slot })}
    onpointerdown={(e) => beginPaint(e, day, slot)}
    onkeydown={(e) => handleKey(e, day, slot)}
  ></button>
{/snippet}

<div bind:this={container}>
  <WeekGrid {weekIso} {grid} {cell} />
</div>
<div class="legend">
  <span>Click or drag to mark your availability. Keyboard: arrow keys to move, Space to toggle.</span>
  <span>■ Available</span>
</div>
