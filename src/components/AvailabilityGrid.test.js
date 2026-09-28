import { render } from '@testing-library/svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { slotWindow } from '../lib/grid.js'
import AvailabilityGrid from './AvailabilityGrid.svelte'

const WEEK = '2026-09-28'
const GRID = { timezone: 'America/Los_Angeles', dayStartHour: 12, slotsPerDay: 24 }

function cellFor(container, day, slot) {
  return container.querySelector(`[data-paint-cell][data-day="${day}"][data-slot="${slot}"]`)
}

function touch(type, target, x, y) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 1, clientX: x, clientY: y }),
  )
}

describe('AvailabilityGrid painting', () => {
  afterEach(() => {
    delete document.elementFromPoint
  })

  test('a touch drag paints every cell the finger passes over, once each', () => {
    const onpaint = vi.fn()
    const { container } = render(AvailabilityGrid, { weekIso: WEEK, grid: GRID, ranges: [], onpaint })
    // No layout in jsdom: treat clientY as the slot index on Monday.
    document.elementFromPoint = (_x, y) => cellFor(container, 0, y)

    touch('pointerdown', cellFor(container, 0, 0), 0, 0)
    touch('pointermove', window, 0, 1)
    touch('pointermove', window, 0, 1)
    touch('pointermove', window, 0, 2)
    touch('pointerup', window, 0, 2)

    expect(onpaint.mock.calls).toEqual([
      [slotWindow(WEEK, 0, 0, 1, GRID), true],
      [slotWindow(WEEK, 0, 1, 1, GRID), true],
      [slotWindow(WEEK, 0, 2, 1, GRID), true],
    ])
  })

  test('erasing skips cells that are already empty, and moves after release do nothing', () => {
    const onpaint = vi.fn()
    const ranges = [slotWindow(WEEK, 0, 0, 2, GRID)]
    const { container } = render(AvailabilityGrid, { weekIso: WEEK, grid: GRID, ranges, onpaint })
    document.elementFromPoint = (_x, y) => cellFor(container, 0, y)

    touch('pointerdown', cellFor(container, 0, 0), 0, 0)
    touch('pointermove', window, 0, 1)
    touch('pointermove', window, 0, 2)
    touch('pointerup', window, 0, 2)
    touch('pointermove', window, 0, 3)

    expect(onpaint.mock.calls).toEqual([
      [slotWindow(WEEK, 0, 0, 1, GRID), false],
      [slotWindow(WEEK, 0, 1, 1, GRID), false],
    ])
  })

  test('every cell is a paint target', () => {
    const { container } = render(AvailabilityGrid, {
      weekIso: WEEK,
      grid: GRID,
      ranges: [],
      onpaint: vi.fn(),
    })
    expect(container.querySelectorAll('[data-paint-cell]')).toHaveLength(7 * 24)
  })
})
