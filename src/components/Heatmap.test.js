import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, test, vi } from 'vitest'
import { sessionWindows, slotWindow } from '../lib/grid.js'
import { rankSuggestions } from '../lib/planning.js'
import Heatmap from './Heatmap.svelte'

const WEEK = '2026-09-28'
const GRID = { timezone: 'America/Los_Angeles', dayStartHour: 12, slotsPerDay: 24 }
const DURATION = 4

const player = (id, ranges, role = 'DPS') => ({
  id,
  checkedIn: true,
  ranges,
  characters: [{ id: `${id}c`, role, main: true, offered: true }],
})

function renderHeatmap(players, targets = [0, 0, 2], onselect = vi.fn()) {
  const windows = sessionWindows(WEEK, DURATION, GRID)
  return render(Heatmap, {
    weekIso: WEEK,
    grid: GRID,
    players,
    suggestions: rankSuggestions(windows, players, targets),
    targets,
    selection: { day: 0, startSlot: 0 },
    durationSlots: DURATION,
    onselect,
  })
}

const cells = (container) => container.querySelectorAll('.heatmap .cell')
const cellAt = (container, day, slot) => cells(container)[slot * 7 + day]

describe('Heatmap', () => {
  test('raid view counts role slots filled and names what is missing', () => {
    // Free Monday slots 0-5: a 4-slot session fits starting at slots 0, 1, and 2 only.
    const { container } = renderHeatmap([player('a', [slotWindow(WEEK, 0, 0, 6, GRID)])])
    expect([0, 1, 2, 3].map((slot) => cellAt(container, 0, slot).textContent)).toEqual(['1', '1', '1', '·'])
    expect(cellAt(container, 0, 0).getAttribute('aria-label')).toMatch(
      /1 of 2 slots filled · Short 1 damage dealer/,
    )
  })

  test('a full raid is marked', () => {
    const free = [slotWindow(WEEK, 0, 0, 4, GRID)]
    const { container } = renderHeatmap([player('a', free), player('b', free)])
    expect(cellAt(container, 0, 0).classList.contains('full')).toBe(true)
    expect(cellAt(container, 0, 0).getAttribute('aria-label')).toMatch(/full raid/)
  })

  test('cells too late to start a full session show a dash', () => {
    const { container } = renderHeatmap([])
    expect(cellAt(container, 0, 20).textContent).toBe('·')
    expect(cellAt(container, 0, 21).textContent).toBe('–')
    expect(cellAt(container, 0, 23).textContent).toBe('–')
  })

  test('role views count players who can fill that role', async () => {
    const free = [slotWindow(WEEK, 0, 0, 4, GRID)]
    const { container } = renderHeatmap([player('t', free, 'Tank'), player('d', free)], [1, 0, 1])
    await fireEvent.click(screen.getByRole('button', { name: 'Tanks' }))
    expect(cellAt(container, 0, 0).textContent).toBe('1')
    expect(cellAt(container, 0, 0).getAttribute('aria-label')).toMatch(
      /1 tanks can stay the full session \(need 1\)/,
    )
    await fireEvent.click(screen.getByRole('button', { name: 'Players' }))
    expect(cellAt(container, 0, 0).textContent).toBe('2')
  })

  test('only one cell is a Tab stop, and arrow keys move it', async () => {
    const { container } = renderHeatmap([])
    const tabStops = [...cells(container)].filter((c) => c.tabIndex === 0)
    expect(tabStops).toEqual([cellAt(container, 0, 0)])

    await fireEvent.keyDown(cellAt(container, 0, 0), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cellAt(container, 1, 0))
    await fireEvent.keyDown(cellAt(container, 1, 0), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cellAt(container, 1, 1))
    expect(cellAt(container, 1, 1).tabIndex).toBe(0)
    expect(cellAt(container, 0, 0).tabIndex).toBe(-1)
  })
})
