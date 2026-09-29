import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { getWeek } from '../lib/model.js'
import { createSeedState, SEED_WEEK } from '../lib/seed.js'
import { addDays } from '../lib/time.js'
import Planner from './Planner.svelte'

const savedPlan = () => getWeek(app.data, SEED_WEEK).plan

describe('Planner locks', () => {
  beforeEach(() => {
    app.data = createSeedState()
  })

  test('a locked player survives "Rebuild roster" and switching to another suggested window', async () => {
    render(Planner)
    await fireEvent.click(screen.getByRole('button', { name: 'Lock Frostbyte' }))
    expect(savedPlan().locked).toEqual(['m6'])
    expect(screen.getByRole('button', { name: 'Unlock Frostbyte' }).getAttribute('aria-pressed')).toBe('true')

    await fireEvent.click(screen.getByRole('button', { name: /Rebuild roster/ }))
    expect(savedPlan().team.some((e) => e.memberId === 'm6')).toBe(true)

    const alternative = screen.getAllByRole('button').find((b) => b.textContent.includes('ALTERNATIVE 01'))
    await fireEvent.click(alternative)
    expect(savedPlan().team.some((e) => e.memberId === 'm6')).toBe(true)
    expect(savedPlan().locked).toEqual(['m6'])
  })

  test('moving a locked player to the bench releases the lock', async () => {
    render(Planner)
    await fireEvent.click(screen.getByRole('button', { name: 'Lock Frostbyte' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Frostbyte' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Move to bench' }))
    expect(savedPlan().team.some((e) => e.memberId === 'm6')).toBe(false)
    expect(savedPlan().locked).toEqual([])
  })

  test('suggestion cards show backups per role', () => {
    render(Planner)
    const top = screen.getAllByRole('button').find((b) => b.textContent.includes('TOP SUGGESTION'))
    expect(top.textContent).toMatch(/Backups: \d+ T · \d+ H · \d+ D/)
  })
})

describe('Planner after the raid', () => {
  beforeEach(() => {
    app.data = createSeedState()
  })

  test('marking attendance saves the suggested roster and records the status', async () => {
    render(Planner)
    const group = screen.getByRole('group', { name: 'Attendance for Stoneguard' })
    await fireEvent.click(within(group).getByRole('button', { name: 'No-show' }))
    expect(savedPlan().attendance).toEqual({ m0: 'noshow' })
    expect(within(group).getByRole('button', { name: 'No-show' }).getAttribute('aria-pressed')).toBe('true')

    // Clicking the pressed status again clears it.
    await fireEvent.click(within(group).getByRole('button', { name: 'No-show' }))
    expect(savedPlan().attendance).toEqual({})
  })

  test('a raid can be marked cancelled', async () => {
    render(Planner)
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Raid was cancelled' }))
    expect(savedPlan().cancelled).toBe(true)
    expect(screen.queryByRole('group', { name: 'Attendance for Stoneguard' })).toBeNull()
  })
})

describe('Planner check-ins and weeks', () => {
  beforeEach(() => {
    app.data = createSeedState()
  })

  test('the next-week button moves to an empty week that is waiting on everyone', async () => {
    render(Planner)
    expect(screen.getByRole('heading', { name: 'Everyone has answered' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: /^Next week/ }))
    expect(app.data.currentWeek).toBe(addDays(SEED_WEEK, 7))
    expect(screen.getByRole('heading', { name: 'Waiting on 24' })).toBeTruthy()
  })

  test('the reminder is copied for Discord', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    app.data = { ...createSeedState(), currentWeek: addDays(SEED_WEEK, 7) }
    render(Planner)
    await fireEvent.click(screen.getByRole('button', { name: 'Copy reminder for Discord' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Still waiting on: Adam, Briar'))
    vi.unstubAllGlobals()
  })

  test('the bench is grouped by whether players can come', () => {
    render(Planner)
    expect(screen.getByRole('heading', { name: /Free for this session/ })).toBeTruthy()
  })
})
