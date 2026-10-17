import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const WEEK = '2026-10-26'

vi.mock('../lib/remote/client.js', () => ({ supabase: {} }))
vi.mock('../lib/remote/sync.svelte.js', () => ({ remote: { guildId: 'g1' } }))
vi.mock('../lib/app.svelte.js', () => ({
  app: {
    data: {
      members: [
        { id: 'm1', name: 'Nova' },
        { id: 'm2', name: 'Brick' },
        { id: 'm3', name: 'Jaina' },
        { id: 'm4', name: 'Sylvanas' },
      ],
      characters: [
        { id: 'c1', memberId: 'm1', name: 'Starfall', class: 'Mage', spec: 'Frost', role: 'DPS' },
        { id: 'c2', memberId: 'm2', name: 'Bulwark', class: 'Warrior', spec: 'Protection', role: 'Tank' },
      ],
      weeks: {},
    },
  },
}))
vi.mock('../lib/discord-channel.svelte.js', () => ({ discordChannel: { channelId: '733333333333333334' } }))
vi.mock('../lib/discord-delivery.svelte.js', () => ({ sendQueued: vi.fn(async () => 'Sent to Discord.') }))
vi.mock('../lib/toast.svelte.js', () => ({ showToast: vi.fn() }))
vi.mock('../lib/raid-services.js', () => ({
  listRaidSignups: vi.fn(async () => [
    { raid_id: 'raid-20', member_id: 'm1', status: 'signed', character_id: 'c1', after_deadline: false },
    { raid_id: 'raid-20', member_id: 'm2', status: 'late', character_id: 'c2', after_deadline: true },
    { raid_id: 'raid-20', member_id: 'm3', status: 'tentative', character_id: null, after_deadline: false },
    { raid_id: 'raid-20', member_id: 'm4', status: 'absent', character_id: null, after_deadline: false },
    { raid_id: 'raid-10', member_id: 'm1', status: 'signed', character_id: 'c1', after_deadline: false },
  ]),
  getSignupPost: vi.fn(async () => []),
  queueSignupPost: vi.fn(async () => 'delivery-1'),
}))

const services = await import('../lib/raid-services.js')
const delivery = await import('../lib/discord-delivery.svelte.js')
const channel = await import('../lib/discord-channel.svelte.js')
const { default: SignupsPanel } = await import('./SignupsPanel.svelte')

beforeEach(() => {
  vi.clearAllMocks()
  channel.discordChannel.channelId = '733333333333333334'
})

describe('Discord sign-ups panel', () => {
  test('shows this raid’s sign-ups by answer, flagging late changes', async () => {
    render(SignupsPanel, { week: WEEK, raidId: 'raid-20', canManage: true })
    expect(await screen.findByText(/2 coming/)).toBeTruthy()
    expect(services.listRaidSignups).toHaveBeenCalledWith({}, 'g1', WEEK)
    const coming = screen.getByRole('list', { name: 'Coming' })
    expect(coming.textContent).toMatch(/Nova.*Starfall.*Frost Mage/)
    expect(coming.textContent).toMatch(/Brick.*Bulwark.*late.*after the deadline/)
    expect(screen.getByRole('list', { name: 'Tentative' }).textContent).toMatch(/Jaina/)
    expect(screen.getByRole('list', { name: 'Absent' }).textContent).toMatch(/Sylvanas/)
    expect(screen.queryByText(/raid-10/)).toBeNull()
  })

  test('officers post the sign-up to Discord and it is sent at once', async () => {
    render(SignupsPanel, { week: WEEK, raidId: 'raid-20', canManage: true })
    await fireEvent.click(await screen.findByRole('button', { name: 'Post sign-up in Discord' }))
    expect(services.queueSignupPost).toHaveBeenCalledWith({}, 'g1', WEEK, 'raid-20')
    await waitFor(() => expect(delivery.sendQueued).toHaveBeenCalledWith(WEEK, 'raid-20'))
  })

  test('a posted sign-up offers an update instead', async () => {
    services.getSignupPost.mockResolvedValueOnce([{ status: 'sent', posted: true, last_error: null }])
    render(SignupsPanel, { week: WEEK, raidId: 'raid-20', canManage: true })
    expect(await screen.findByRole('button', { name: 'Update sign-up post' })).toBeTruthy()
    expect(screen.getByText(/Posted in Discord/)).toBeTruthy()
  })

  test('without the bot channel, officers are told how to enable sign-up posts', async () => {
    channel.discordChannel.channelId = ''
    render(SignupsPanel, { week: WEEK, raidId: 'raid-20', canManage: true })
    expect(await screen.findByText(/need the WhenToRaid bot/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /sign-up/i })).toBeNull()
  })

  test('players see the sign-ups but cannot post', async () => {
    render(SignupsPanel, { week: WEEK, raidId: 'raid-20', canManage: false })
    expect(await screen.findByText(/2 coming/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /sign-up/i })).toBeNull()
    expect(services.getSignupPost).not.toHaveBeenCalled()
  })
})
