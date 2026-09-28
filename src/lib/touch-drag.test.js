import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { touchDrag } from './touch-drag.js'

const TOUCH = { pointerType: 'touch', pointerId: 7 }

function pointer(type, target, { x, y, ...rest }) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, ...TOUCH, ...rest }))
}

describe('touchDrag', () => {
  let card, tankColumn, ondrop, action

  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <div id="card"><span id="label">Card</span><button id="edit">…</button></div>
      <section id="tank" data-drop="Tank"><span id="inside-tank">Tanks</span></section>`
    card = document.getElementById('card')
    tankColumn = document.getElementById('tank')
    // jsdom has no layout: the tank column sits at y >= 100, everything else misses.
    document.elementFromPoint = (x, y) => (y >= 100 ? document.getElementById('inside-tank') : document.body)
    window.scrollBy = vi.fn()
    ondrop = vi.fn()
    action = touchDrag(card, { ondrop })
  })

  afterEach(() => {
    action.destroy()
    vi.useRealTimers()
    delete document.elementFromPoint
  })

  test('press, hold, drag, and release over a drop zone calls ondrop', () => {
    pointer('pointerdown', card, { x: 10, y: 10 })
    vi.advanceTimersByTime(400)
    expect(card.classList.contains('dragging')).toBe(true)
    expect(document.querySelector('.drag-ghost')).not.toBeNull()

    pointer('pointermove', window, { x: 10, y: 150 })
    expect(tankColumn.classList.contains('drop-target')).toBe(true)

    pointer('pointerup', window, { x: 10, y: 150 })
    expect(ondrop).toHaveBeenCalledWith('Tank')
    expect(document.querySelector('.drag-ghost')).toBeNull()
    expect(card.classList.contains('dragging')).toBe(false)
    expect(tankColumn.classList.contains('drop-target')).toBe(false)
  })

  test('moving before the hold completes is a scroll, not a drag', () => {
    pointer('pointerdown', card, { x: 10, y: 10 })
    pointer('pointermove', window, { x: 10, y: 40 })
    vi.advanceTimersByTime(400)
    expect(document.querySelector('.drag-ghost')).toBeNull()
    pointer('pointerup', window, { x: 10, y: 150 })
    expect(ondrop).not.toHaveBeenCalled()
  })

  test('releasing outside a drop zone does nothing', () => {
    pointer('pointerdown', card, { x: 10, y: 10 })
    vi.advanceTimersByTime(400)
    pointer('pointermove', window, { x: 10, y: 50 })
    pointer('pointerup', window, { x: 10, y: 50 })
    expect(ondrop).not.toHaveBeenCalled()
  })

  test('a cancelled pointer drops nothing and cleans up', () => {
    pointer('pointerdown', card, { x: 10, y: 10 })
    vi.advanceTimersByTime(400)
    pointer('pointermove', window, { x: 10, y: 150 })
    pointer('pointercancel', window, { x: 10, y: 150 })
    expect(ondrop).not.toHaveBeenCalled()
    expect(document.querySelector('.drag-ghost')).toBeNull()
  })

  test('mouse input and presses on buttons are ignored', () => {
    pointer('pointerdown', card, { x: 10, y: 10, pointerType: 'mouse' })
    vi.advanceTimersByTime(400)
    expect(document.querySelector('.drag-ghost')).toBeNull()

    pointer('pointerdown', document.getElementById('edit'), { x: 10, y: 10 })
    vi.advanceTimersByTime(400)
    expect(document.querySelector('.drag-ghost')).toBeNull()
  })

  test('dragging near the bottom edge scrolls the page, and stops when the drag ends', () => {
    pointer('pointerdown', card, { x: 10, y: 300 })
    vi.advanceTimersByTime(400)
    window.scrollBy.mockClear()

    pointer('pointermove', window, { x: 10, y: window.innerHeight - 5 })
    vi.advanceTimersByTime(100)
    expect(window.scrollBy).toHaveBeenCalled()
    expect(window.scrollBy.mock.calls.every(([, dy]) => dy > 0)).toBe(true)

    pointer('pointerup', window, { x: 10, y: window.innerHeight - 5 })
    window.scrollBy.mockClear()
    vi.advanceTimersByTime(100)
    expect(window.scrollBy).not.toHaveBeenCalled()
  })

  test('no edge scrolling while the finger is mid-screen', () => {
    pointer('pointerdown', card, { x: 10, y: 300 })
    vi.advanceTimersByTime(400)
    vi.advanceTimersByTime(100)
    expect(window.scrollBy).not.toHaveBeenCalled()
  })

  test('the native drag started by a long press is suppressed while touch owns the gesture', () => {
    pointer('pointerdown', card, { x: 10, y: 10 })
    const dragstart = new Event('dragstart', { cancelable: true })
    card.dispatchEvent(dragstart)
    expect(dragstart.defaultPrevented).toBe(true)
  })
})
