import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { getWeek } from '../lib/model.js'
import { createSeedState, SEED_WEEK } from '../lib/seed.js'
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
