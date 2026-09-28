<script>
  import { DAYS } from '../lib/constants.js'
  import { formatSlot, weekSlotWindows } from '../lib/grid.js'
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

  function toggleWithKeyboard(event, day, slot) {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    onpaint(slotWindows[day][slot], !isMine(day, slot))
  }
</script>

<svelte:window onpointermove={continuePaint} onpointerup={endPaint} onpointercancel={endPaint} />

{#snippet cell(day, slot)}
  {@const mine = isMine(day, slot)}
  {@const label = `${DAYS[day]} ${formatSlot(slot, grid)} ${mine ? 'available' : 'unavailable'}`}
  <button
    class="cell"
    class:mine
    data-paint-cell
    data-day={day}
    data-slot={slot}
    aria-pressed={mine}
    aria-label={label}
    title={label}
    onpointerdown={(e) => beginPaint(e, day, slot)}
    onkeydown={(e) => toggleWithKeyboard(e, day, slot)}
  ></button>
{/snippet}

<WeekGrid {weekIso} {grid} {cell} />
<div class="legend">
  <span>Click or drag to mark your availability.</span>
  <span>■ Available</span>
</div>
