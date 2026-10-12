import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { getCheckin, markUnavailable, setCurrentWeek } from '../lib/model.js'
import { slotWindow } from '../lib/grid.js'
import { createSeedState, SEED_WEEK } from '../lib/seed.js'
import { runToastAction, toast } from '../lib/toast.svelte.js'
import Availability from './Availability.svelte'

const NEW_WEEK = '2026-10-05'

describe('Availability view', () => {
  beforeEach(() => {
    app.data = setCurrentWeek(createSeedState(), NEW_WEEK)
  })

  test('there is no submit step: the first painted slot checks you in and counts', async () => {
    const { container } = render(Availability)
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull()
    expect(container.querySelector('small[role=status]').textContent).toMatch(/Not checked in yet/)

    const cell = container.querySelector('[data-paint-cell][data-day="4"][data-slot="12"]')
    await fireEvent.pointerDown(cell, { pointerType: 'touch', pointerId: 1 })
    await fireEvent.pointerUp(window, { pointerType: 'touch', pointerId: 1 })

    const checkin = getCheckin(app.data, NEW_WEEK, 'm0')
    expect(checkin.checkedIn).toBe(true)
    expect(checkin.ranges).toHaveLength(1)
    expect(container.querySelector('small[role=status]').textContent).toMatch(
      /Checked in · changes save automatically/,
    )
  })

  test('"Can’t make it this week" records a response with no availability', async () => {
    const { container } = render(Availability)
    await fireEvent.click(screen.getByRole('button', { name: 'Can’t make it this week' }))
    expect(getCheckin(app.data, NEW_WEEK, 'm0')).toMatchObject({ checkedIn: true, ranges: [] })
    expect(container.querySelector('small[role=status]').textContent).toMatch(/not available this week/)
  })

  test('a day header fills an empty day, and clears a day that has any times', async () => {
    render(Availability)
    const wednesday = slotWindow(NEW_WEEK, 2, 0, app.data.guild.slotsPerDay, app.data.guild)

    await fireEvent.click(screen.getByRole('button', { name: 'Mark Wed available' }))
    expect(getCheckin(app.data, NEW_WEEK, 'm0')).toMatchObject({ checkedIn: true, ranges: [wednesday] })

    await fireEvent.click(screen.getByRole('button', { name: 'Mark Wed unavailable' }))
    expect(getCheckin(app.data, NEW_WEEK, 'm0')).toMatchObject({ checkedIn: true, ranges: [] })
  })

  test('clearing one day keeps the rest of the week', async () => {
    app.data = createSeedState()
    render(Availability)
    const before = getCheckin(app.data, SEED_WEEK, 'm0').ranges
    const friday = slotWindow(SEED_WEEK, 4, 0, app.data.guild.slotsPerDay, app.data.guild)
    expect(before.some((r) => r.start < friday.end && r.end > friday.start)).toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: 'Mark Fri unavailable' }))
    const after = getCheckin(app.data, SEED_WEEK, 'm0').ranges
    expect(after.some((r) => r.start < friday.end && r.end > friday.start)).toBe(false)
    expect(after).toEqual(before.filter((r) => r.end <= friday.start || r.start >= friday.end))
  })

  test('warns when no character is offered', async () => {
    render(Availability)
    expect(screen.queryByText(/can’t place you/)).toBeNull()
    for (const box of screen.getAllByRole('checkbox')) await fireEvent.click(box)
    expect(screen.getByText(/can’t place you/)).toBeTruthy()
  })

  test('a whole paint gesture is one undo and day clearing can also be undone', async () => {
    const { container } = render(Availability)
    const cell = container.querySelector('[data-paint-cell][data-day="4"][data-slot="12"]')
    await fireEvent.pointerDown(cell, { pointerType: 'touch', pointerId: 1 })
    await fireEvent.pointerUp(window, { pointerType: 'touch', pointerId: 1 })
    expect(getCheckin(app.data, NEW_WEEK, 'm0').ranges).toHaveLength(1)
    runToastAction()
    expect(getCheckin(app.data, NEW_WEEK, 'm0').checkedIn).toBe(false)
    await fireEvent.click(screen.getByRole('button', { name: 'Mark Wed available' }))
    runToastAction()
    expect(getCheckin(app.data, NEW_WEEK, 'm0').ranges).toEqual([])
  })

  test('the time range editor adds an exact interval and unavailable can be undone', async () => {
    render(Availability)
    await fireEvent.click(screen.getByRole('button', { name: 'Time ranges' }))
    const interval = slotWindow(NEW_WEEK, 1, 10, 4, app.data.guild)
    await fireEvent.change(screen.getByLabelText('Tue from'), { target: { value: String(interval.start) } })
    await fireEvent.change(screen.getByLabelText('Tue until'), { target: { value: String(interval.end) } })
    await fireEvent.click(screen.getByRole('button', { name: 'Add times for Tue' }))
    expect(getCheckin(app.data, NEW_WEEK, 'm0').ranges).toEqual([interval])
    await fireEvent.click(screen.getByRole('button', { name: 'Can’t make it this week' }))
    expect(getCheckin(app.data, NEW_WEEK, 'm0').ranges).toEqual([])
    runToastAction()
    expect(getCheckin(app.data, NEW_WEEK, 'm0').ranges).toEqual([interval])
  })
})

describe('Availability undo with other people editing', () => {
  beforeEach(() => {
    app.data = setCurrentWeek(createSeedState(), NEW_WEEK)
  })

  test('undo restores only my check-in and keeps another player’s change made meanwhile', async () => {
    const mine = getCheckin(app.data, NEW_WEEK, app.data.currentMemberId)
    render(Availability)
    await fireEvent.click(screen.getByRole('button', { name: 'Can’t make it this week' }))
    const other = app.data.members.find((m) => m.id !== app.data.currentMemberId).id
    app.data = markUnavailable(app.data, app.data.currentWeek, other)
    runToastAction()
    expect(getCheckin(app.data, app.data.currentWeek, other)).toMatchObject({ checkedIn: true, ranges: [] })
    expect(toast.message).toBe('Undone.')
    expect(getCheckin(app.data, NEW_WEEK, app.data.currentMemberId)).toEqual(mine)
  })
})
