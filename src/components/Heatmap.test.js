import { render } from '@testing-library/svelte'
import { describe, expect, test, vi } from 'vitest'
import { sessionWindows, slotWindow } from '../lib/grid.js'
import Heatmap from './Heatmap.svelte'

const WEEK = '2026-09-28'
const GRID = { timezone: 'America/Los_Angeles', dayStartHour: 12, slotsPerDay: 24 }
const DURATION = 4

const player = (id, ranges) => ({
  id,
  checkedIn: true,
  ranges,
  characters: [{ id: `${id}c`, role: 'DPS', main: true, offered: true }],
})

function renderHeatmap(players) {
  return render(Heatmap, {
    weekIso: WEEK,
    grid: GRID,
    players,
    windows: sessionWindows(WEEK, DURATION, GRID),
    selection: { day: 0, startSlot: 0 },
    durationSlots: DURATION,
    onselect: vi.fn(),
  })
}

const cellText = (container, day, slot) =>
  container.querySelectorAll('.heatmap .cell')[slot * 7 + day].textContent

describe('Heatmap', () => {
  test('counts players who can stay for a full session starting at each cell', () => {
    // Free Monday slots 0-5: a 4-slot session fits starting at slots 0, 1, and 2 only.
    const { container } = renderHeatmap([player('a', [slotWindow(WEEK, 0, 0, 6, GRID)])])
    expect([0, 1, 2, 3, 4].map((slot) => cellText(container, 0, slot))).toEqual(['1', '1', '1', '·', '·'])
  })

  test('cells too late to start a full session show a dash', () => {
    const { container } = renderHeatmap([])
    expect(cellText(container, 0, 20)).toBe('·')
    expect(cellText(container, 0, 21)).toBe('–')
    expect(cellText(container, 0, 23)).toBe('–')
  })

  test('shading is relative to guild size', () => {
    const everyone = [slotWindow(WEEK, 0, 0, 4, GRID)]
    const small = renderHeatmap([player('a', everyone)]).container
    const full = small.querySelectorAll('.heatmap .cell')[0].style.background
    const big = renderHeatmap([
      player('a', everyone),
      player('b', []),
      player('c', []),
      player('d', []),
    ]).container
    const quarter = big.querySelectorAll('.heatmap .cell')[0].style.background
    expect(full).toBe('rgb(112, 164, 98)')
    expect(quarter).not.toBe(full)
  })
})
