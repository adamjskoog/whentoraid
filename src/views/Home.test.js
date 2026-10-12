import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { createSeedState, SEED_WEEK } from '../lib/seed.js'
import Home from './Home.svelte'
import { localRaidResponses, saveLocalRaidResponse } from '../lib/raid-services.js'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.parse('2026-09-28T12:00:00Z'))
  app.data = createSeedState()
  const start = Date.parse('2026-10-02T23:30:00Z')
  app.data.weeks[SEED_WEEK].plans['raid-20'] = {
    start: start + 60000,
    team: [],
    published: {
      start,
      end: start + 3 * 3600000,
      publishedAt: 1000,
      team: [{ memberId: 'm0', characterId: 'c0a', role: 'Tank' }],
    },
  }
})

afterEach(() => vi.useRealTimers())

test('shows the current member’s published assignment and opens its week and raid', async () => {
  render(Home)
  const next = screen.getByRole('region', { name: 'Next raid assignment' })
  expect(within(next).getByText('Stoneguard')).toBeTruthy()
  expect(within(next).getByText('Tank')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'You’re ready for planning' })).toBeTruthy()
  await fireEvent.click(within(next).getByRole('button', { name: 'View published roster' }))
  expect(app.view).toBe('planner')
  expect(app.data.currentWeek).toBe(SEED_WEEK)
  expect(app.data.currentRaidId).toBe('raid-20')
})

test('another player is not shown someone else’s assignment', () => {
  app.data = { ...app.data, currentMemberId: 'm1' }
  render(Home)
  expect(screen.getByRole('heading', { name: 'No upcoming assignment yet' })).toBeTruthy()
  expect(screen.getByText('You are not on this roster')).toBeTruthy()
})

test('a newly joined player is guided to add a character and check in', async () => {
  app.data = {
    ...app.data,
    currentMemberId: 'new-player',
    members: [...app.data.members, { id: 'new-player', name: 'Nova', discordId: '' }],
  }
  render(Home)
  expect(screen.getByRole('heading', { name: 'Get ready for your first raid' })).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: 'Add character' }))
  expect(app.view).toBe('characters')
})

test('a rostered player confirms their place, then reports a late problem with a note', async () => {
  render(Home)
  const next = screen.getByRole('region', { name: 'Next raid assignment' })
  await fireEvent.click(within(next).getByRole('button', { name: 'I’ll be there' }))
  expect(await within(next).findByText('You confirmed you’ll be there.')).toBeTruthy()
  expect(within(next).queryByRole('button', { name: 'I’ll be there' })).toBeNull()

  await fireEvent.click(within(next).getByRole('button', { name: 'I can’t make it' }))
  await fireEvent.input(within(next).getByLabelText(/What’s changed/), { target: { value: 'Working late' } })
  await fireEvent.click(within(next).getByRole('button', { name: 'Tell the officers' }))
  expect(await within(next).findByText(/can’t make it: “Working late”/)).toBeTruthy()
  const [saved] = localRaidResponses('browser', SEED_WEEK, 'raid-20')
  expect(saved).toMatchObject({
    member_id: 'm0',
    status: 'unavailable',
    note: 'Working late',
    publication: '1000',
  })
})

test('a response given before the raid time changed is not shown as current', async () => {
  const published = app.data.weeks[SEED_WEEK].plans['raid-20'].published
  const earlier = { ...published, start: published.start - 3600000, end: published.end - 3600000 }
  saveLocalRaidResponse('browser', SEED_WEEK, 'raid-20', 'm0', earlier, 'unavailable', 'Old')
  render(Home)
  const next = screen.getByRole('region', { name: 'Next raid assignment' })
  expect(await within(next).findByRole('button', { name: 'I’ll be there' })).toBeTruthy()
  expect(within(next).queryByText(/Old/)).toBeNull()
})
