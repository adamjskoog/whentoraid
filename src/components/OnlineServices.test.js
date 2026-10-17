import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../lib/remote/client.js', () => ({ supabase: {} }))
vi.mock('../lib/remote/sync.svelte.js', () => ({
  remote: { guildId: 'g1', memberId: 'm0' },
  canManage: () => true,
}))
vi.mock('../lib/raid-services.js', () => ({
  getReminderSettings: vi.fn(async () => ({
    checkin_enabled: false,
    upcoming_enabled: false,
    interval_hours: 24,
    lead_hours: 24,
    only_unconfirmed: true,
    signup_enabled: false,
    signup_lead_days: 7,
  })),
  setReminderSettings: vi.fn(async () => {}),
  createCalendarSubscription: vi.fn(async () => 'a'.repeat(64)),
  revokeCalendarSubscription: vi.fn(async () => {}),
  calendarSubscriptionUrl: (base, token) => `${base}/functions/v1/raid-calendar?token=${token}`,
}))

const services = await import('../lib/raid-services.js')
const { default: ReminderSettings } = await import('./ReminderSettings.svelte')
const { default: CalendarSubscription } = await import('./CalendarSubscription.svelte')

beforeEach(() => vi.clearAllMocks())

describe('Discord reminder settings', () => {
  test('start off; turning on the pre-raid reminder saves its options', async () => {
    render(ReminderSettings)
    const upcoming = await screen.findByRole('checkbox', { name: /before a published raid/ })
    expect(upcoming.checked).toBe(false)
    expect(screen.getByRole('button', { name: 'Save reminders' }).disabled).toBe(true)

    await fireEvent.click(upcoming)
    await fireEvent.input(screen.getByLabelText('Hours before the raid'), { target: { value: '6' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }))
    expect(services.setReminderSettings).toHaveBeenCalledWith(
      {},
      'g1',
      expect.objectContaining({ upcoming_enabled: true, lead_hours: 6 }),
    )
  })

  test('turning on sign-up posts saves how many days ahead they appear', async () => {
    render(ReminderSettings)
    const signups = await screen.findByRole('checkbox', { name: /Post sign-ups/ })
    expect(signups.checked).toBe(false)
    await fireEvent.click(signups)
    await fireEvent.change(screen.getByLabelText('Days before the raid'), { target: { value: '3' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }))
    expect(services.setReminderSettings).toHaveBeenCalledWith(
      {},
      'g1',
      expect.objectContaining({ signup_enabled: true, signup_lead_days: 3 }),
    )
  })

  test('an out-of-range lead time is refused before saving', async () => {
    render(ReminderSettings)
    await fireEvent.click(await screen.findByRole('checkbox', { name: /before a published raid/ }))
    await fireEvent.input(screen.getByLabelText('Hours before the raid'), { target: { value: '500' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }))
    expect(services.setReminderSettings).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Hours before the raid').validity.valid).toBe(false)
  })
})

describe('calendar link', () => {
  test('creating shows the private link once, and turning it off hides it', async () => {
    render(CalendarSubscription)
    await fireEvent.click(screen.getByRole('button', { name: 'Create calendar link' }))
    const link = await screen.findByLabelText('Your calendar link')
    expect(link.value).toMatch(/raid-calendar\?token=a{64}$/)
    await fireEvent.click(screen.getByRole('button', { name: 'Turn off link' }))
    expect(services.revokeCalendarSubscription).toHaveBeenCalled()
    expect(screen.queryByLabelText('Your calendar link')).toBeNull()
  })
})
