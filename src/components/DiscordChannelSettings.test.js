import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const SERVER = '700000000000000001'
const ROSTER = '800000000000000003'

vi.mock('../lib/remote/client.js', () => ({ supabase: {} }))
vi.mock('../lib/remote/sync.svelte.js', () => ({
  remote: { guildId: 'g1', memberId: 'm0' },
  canManage: () => true,
}))
vi.mock('../lib/remote/api.js', () => ({
  getGuildDiscord: vi.fn(),
  setGuildDiscord: vi.fn(async () => {}),
  recordDiscordPost: vi.fn(async () => {}),
}))
vi.mock('../lib/discord-connect.js', () => ({
  hasDiscordReturn: vi.fn(() => false),
  finishDiscordConnect: vi.fn(async () => null),
  startDiscordConnect: vi.fn(async () => {}),
  listDiscordChannels: vi.fn(async () => [
    { id: '800000000000000001', name: 'general', category: '', canPost: true },
    { id: '800000000000000004', name: 'officers', category: 'Raiding', canPost: false },
    { id: ROSTER, name: 'roster', category: 'Raiding', canPost: true },
  ]),
}))
vi.mock('../lib/toast.svelte.js', () => ({ showToast: vi.fn() }))

const api = await import('../lib/remote/api.js')
const connect = await import('../lib/discord-connect.js')
const { showToast } = await import('../lib/toast.svelte.js')
const { loadDiscordChannel } = await import('../lib/discord-channel.svelte.js')
const { default: DiscordChannelSettings } = await import('./DiscordChannelSettings.svelte')

const stored = (overrides = {}) => ({
  webhookUrl: '',
  channelId: '',
  mentionPlayers: false,
  posts: {},
  serverId: '',
  serverName: '',
  ...overrides,
})

beforeEach(async () => {
  vi.clearAllMocks()
  connect.hasDiscordReturn.mockReturnValue(false)
})

async function show(row) {
  api.getGuildDiscord.mockResolvedValue(row)
  await loadDiscordChannel({ force: true })
  render(DiscordChannelSettings)
}

describe('connecting the WhenToRaid bot', () => {
  test('before the bot is added, one button opens Discord for this guild', async () => {
    await show(null)
    await fireEvent.click(screen.getByRole('button', { name: 'Add WhenToRaid to Discord' }))
    expect(connect.startDiscordConnect).toHaveBeenCalledWith({}, 'g1')
    expect(screen.queryByLabelText('Bot channel')).toBeNull()
  })

  test('once added, the officer picks a channel by name and saves it', async () => {
    await show(stored({ serverId: SERVER, serverName: 'After Hours' }))
    expect(screen.getByText('After Hours')).toBeTruthy()
    const select = screen.getByLabelText('Bot channel')
    await waitFor(() => expect(select.options.length).toBe(4))
    const officers = [...select.options].find((o) => o.value === '800000000000000004')
    expect(officers.disabled).toBe(true)
    expect(officers.textContent).toMatch(/bot can’t post here/)

    await fireEvent.change(select, { target: { value: ROSTER } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save channel' }))
    expect(api.setGuildDiscord).toHaveBeenCalledWith({}, 'g1', expect.objectContaining({ channelId: ROSTER }))
  })

  test('coming back from Discord finishes the connection and offers the channels', async () => {
    connect.hasDiscordReturn.mockReturnValue(true)
    connect.finishDiscordConnect.mockResolvedValueOnce({ serverId: SERVER, serverName: 'After Hours' })
    await show(null)
    api.getGuildDiscord.mockResolvedValue(stored({ serverId: SERVER, serverName: 'After Hours' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/joined After Hours/)))
    expect(connect.finishDiscordConnect).toHaveBeenCalledWith({}, 'g1')
    expect(await screen.findByLabelText('Bot channel')).toBeTruthy()
  })

  test('a failed return is explained, and the add button stays', async () => {
    connect.hasDiscordReturn.mockReturnValue(true)
    connect.finishDiscordConnect.mockRejectedValueOnce(
      new Error('The bot was not added to a Discord server.'),
    )
    await show(null)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('The bot was not added to a Discord server.'))
    expect(screen.getByRole('button', { name: 'Add WhenToRaid to Discord' })).toBeTruthy()
  })
})
