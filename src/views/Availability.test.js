import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { getCheckin, setCurrentWeek } from '../lib/model.js'
import { createSeedState } from '../lib/seed.js'
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

  test('warns when no character is offered', async () => {
    render(Availability)
    expect(screen.queryByText(/can’t place you/)).toBeNull()
    for (const box of screen.getAllByRole('checkbox')) await fireEvent.click(box)
    expect(screen.getByText(/can’t place you/)).toBeTruthy()
  })
})
