import { render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { setCurrentWeek } from '../lib/model.js'
import { createSeedState } from '../lib/seed.js'
import Availability from './Availability.svelte'

// An online player, not an officer.
vi.mock('../lib/remote/sync.svelte.js', () => ({ canManage: () => false }))

// The week of Oct 5 closed on Wednesday Oct 7, 6 pm Los Angeles time (Oct 8, 01:00 UTC).
const CLOSED_WEEK = '2026-10-05'
const OPEN_WEEK = '2026-10-12'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 9, 8, 2, 0))
})

afterEach(() => vi.useRealTimers())

test('after the deadline a player sees the week but cannot change it', () => {
  app.data = setCurrentWeek(createSeedState(), CLOSED_WEEK)
  const { container } = render(Availability)
  expect(screen.getByText(/Check-ins for this week closed at the deadline/)).toBeTruthy()
  expect(container.querySelector('.availability-layout > .panel').inert).toBe(true)
  expect(container.querySelector('fieldset').disabled).toBe(true)
})

test('a week whose deadline is ahead stays editable', () => {
  app.data = setCurrentWeek(createSeedState(), OPEN_WEEK)
  const { container } = render(Availability)
  expect(screen.queryByText(/closed at the deadline/)).toBeNull()
  expect(container.querySelector('.availability-layout > .panel').inert).toBeFalsy()
  expect(container.querySelector('fieldset').disabled).toBe(false)
})
