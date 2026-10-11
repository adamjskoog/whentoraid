import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { getWeek, setPlan } from '../lib/model.js'
import { plannerContext } from '../lib/planning.js'
import { createSeedState, SEED_WEEK } from '../lib/seed.js'
import { addDays } from '../lib/time.js'
import { toast } from '../lib/toast.svelte.js'
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

describe('Planner roster cards', () => {
  beforeEach(() => {
    app.data = createSeedState()
  })

  test('each card shows its spec icon, and the class color is set for the name', () => {
    render(Planner)
    const card = screen.getByRole('button', { name: 'Edit Stoneguard' }).closest('.player')
    expect(card.querySelector('img.spec-icon').getAttribute('src')).toContain(
      'ability_warrior_defensivestance',
    )
    expect(card.style.getPropertyValue('--class')).toBe('#c69b6d')
  })

  test('a spec typed before the dropdown existed falls back to the role symbol', () => {
    app.data = {
      ...app.data,
      characters: app.data.characters.map((c) => (c.id === 'c0a' ? { ...c, spec: 'Deep Prot' } : c)),
    }
    render(Planner)
    const card = screen.getByRole('button', { name: 'Edit Stoneguard' }).closest('.player')
    expect(card.querySelector('img.spec-icon')).toBeNull()
    expect(card.querySelector('.mini').textContent).toBe('◈')
  })
})

describe('Planner moving the session', () => {
  beforeEach(() => {
    app.data = createSeedState()
  })

  test('players who cannot make the new time are benched, locked players stay, and Undo restores', async () => {
    const { container } = render(Planner)
    await fireEvent.click(screen.getByRole('button', { name: 'Lock Frostbyte' }))
    const before = savedPlan().team

    // Monday at the first slot: nobody in the seed guild is free.
    await fireEvent.click(container.querySelector('.cell[data-day="0"][data-slot="0"]'))
    expect(savedPlan().team.map((e) => e.memberId)).toEqual(['m6'])
    expect(savedPlan().locked).toEqual(['m6'])
    expect(toast.message).toMatch(/^19 players who can’t make this time moved to the bench/)

    await fireEvent.click(screen.getByRole('button', { name: 'Undo roster change' }))
    expect(savedPlan().team).toEqual(before)
  })
})

describe('Planner readiness', () => {
  beforeEach(() => {
    app.data = createSeedState()
  })

  test('role slots count only rostered players who can make the chosen time', () => {
    const { plan, windows } = plannerContext(app.data)
    // Keep the full Friday roster but move it to Monday noon, which nobody in the seed guild can make.
    const monday = windows.find((w) => w.day === 0 && w.startSlot === 0)
    app.data = setPlan(app.data, SEED_WEEK, { start: monday.start, team: plan.team })
    render(Planner)

    const readiness = screen.getByText('RAID READINESS').closest('section')
    const tanks = within(readiness)
      .getByText(/Tank slots/)
      .closest('.check')
    expect(tanks.textContent).toContain('0 / 2')
    expect(tanks.textContent).toMatch(/2 rostered can’t play/)
  })
})

describe('Planner after the raid', () => {
  beforeEach(() => {
    const seed = createSeedState()
    app.data = { ...seed, settings: { ...seed.settings, trackAttendance: true } }
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

describe('Planner without attendance tracking', () => {
  beforeEach(() => {
    app.data = createSeedState()
  })

  test('attendance is off by default, and a raid can still be marked cancelled', async () => {
    render(Planner)
    expect(screen.queryByRole('group', { name: 'Attendance for Stoneguard' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'After the raid' })).toBeNull()

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Raid was cancelled' }))
    expect(savedPlan().cancelled).toBe(true)
    expect(screen.getByText('This raid is cancelled.')).toBeTruthy()
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

  test('a roster over Discord’s limit is copied one message at a time', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const seed = createSeedState()
    const long = (i) => `${'Longname'.repeat(3)}${String(i).padStart(6, '0')}`
    app.data = {
      ...seed,
      members: seed.members.map((m, i) => ({ ...m, name: long(i) })),
      characters: seed.characters.map((c, i) => ({ ...c, name: long(100 + i) })),
    }
    render(Planner)

    await fireEvent.click(screen.getByRole('button', { name: 'Copy for Discord' }))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(toast.message).toMatch(/^Copied message 1 of 2\./)
    expect(toast.action.label).toBe('Copy message 2')

    toast.action.run()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(writeText.mock.calls[1][0]).toMatch(/^\*\(continued\)\*/)
    for (const [text] of writeText.mock.calls) expect(text.length).toBeLessThanOrEqual(2000)
    vi.unstubAllGlobals()
  })

  test('the bench is grouped by whether players can come', () => {
    render(Planner)
    expect(screen.getByRole('heading', { name: /Free for this session/ })).toBeTruthy()
  })
})
