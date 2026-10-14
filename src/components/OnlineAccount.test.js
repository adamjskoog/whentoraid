import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { expect, test, vi } from 'vitest'

vi.mock('../lib/remote/sync.svelte.js', () => ({
  remote: {
    enabled: true,
    ready: true,
    signedIn: true,
    discordId: '700000000000000001',
    guildId: 'g1',
    guilds: [{ id: 'g1', name: 'Unsanctioned' }],
  },
  createOnlineGuild: vi.fn(async () => 'g2'),
  leaveGuild: vi.fn(),
  localTestSignIn: vi.fn(),
  localTestSignInAvailable: false,
  openGuild: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../lib/toast.svelte.js', () => ({ showToast: vi.fn() }))

const { createOnlineGuild } = await import('../lib/remote/sync.svelte.js')
const { showToast } = await import('../lib/toast.svelte.js')
const { default: OnlineAccount } = await import('./OnlineAccount.svelte')

test('a signed-in officer creates a separate demo guild online to test with', async () => {
  render(OnlineAccount)
  await fireEvent.click(screen.getByRole('button', { name: 'Create a demo guild online' }))
  await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/Demo guild created/)))
  const [state] = createOnlineGuild.mock.calls[0]
  expect(state.guild.name).toMatch(/\(demo\)$/)
  expect(state.demoYear).toBeGreaterThan(2000)
  expect(state.members.length).toBe(24)
})
