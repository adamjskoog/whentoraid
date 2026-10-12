import { describe, expect, it, vi } from 'vitest'
import {
  deliverMessages,
  personalCalendar,
  reminderMessages,
  rosterMessages,
} from '../../supabase/functions/_shared/raid-service-core.js'

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz'

describe('raid delivery worker core', () => {
  it('uses stable calendar identities, sequences and cancelled events without leaking other players', () => {
    const event = {
      guild_id: 'g',
      week: '2026-10-12',
      raid_id: 'raid-a',
      member_id: 'm',
      start_ms: 1791835200000,
      end_ms: 1791842400000,
      sequence: 3,
      title: 'Raid, one',
      description: 'Bring Nova',
      cancelled: true,
      updated_at: '2026-10-11T00:00:00Z',
    }
    const calendar = personalCalendar([event])
    expect(calendar).toContain('UID:g-2026-10-12-raid-a-m@whentoraid')
    expect(calendar).toContain('STATUS:CANCELLED')
    expect(calendar).toContain('SEQUENCE:3')
    expect(calendar).toContain('SUMMARY:Raid\\, one')
    expect(calendar).not.toContain('undefined')
  })
  it('escapes user-controlled Discord mentions and chunks long rosters', () => {
    const messages = rosterMessages({
      guildName: '@everyone',
      raidName: 'Raid',
      start: 1791835200000,
      team: Array.from({ length: 40 }, (_, i) => ({ name: 'N'.repeat(100) + i, role: 'DPS' })),
    })
    expect(messages.length).toBeGreaterThan(1)
    expect(messages.every((message) => message.length <= 1900)).toBe(true)
    expect(messages.join('')).not.toContain('@everyone')
  })
  it('checkpoints each created message and edits known messages on retry', async () => {
    const calls = []
    const fetchFn = vi.fn(async (url, init) => {
      calls.push({ url, ...init })
      return new Response(JSON.stringify({ id: '123456789012345678' }), { status: 200 })
    })
    const checkpoint = vi.fn()
    await deliverMessages(HOOK, ['First'], [], { fetchFn, checkpoint })
    expect(checkpoint).toHaveBeenCalledWith(['123456789012345678'])
    await deliverMessages(HOOK, ['Changed'], ['123456789012345678'], { fetchFn, checkpoint })
    expect(calls.map((call) => call.method)).toEqual(['POST', 'PATCH'])
    expect(JSON.parse(calls[0].body).allowed_mentions).toEqual({ parse: [], users: [] })
  })
  it('marks ambiguous creates for officer reconciliation, without retrying the POST', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('timeout')
    })
    await expect(
      deliverMessages(HOOK, ['First'], [], { fetchFn, checkpoint: async () => {} }),
    ).rejects.toMatchObject({ uncertain: true })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
  it('reminds only the listed players, mentioning those linked to Discord', () => {
    const [message] = reminderMessages({
      kind: 'upcoming',
      raidName: 'Raid',
      start: 1791835200000,
      recipients: [
        { name: 'Nova', discordId: '522222222222222222' },
        { name: '@everyone', discordId: '' },
      ],
    })
    expect(message).toContain('<@522222222222222222>')
    expect(message).not.toContain('@everyone')
    expect(reminderMessages({ kind: 'checkin', week: '2026-10-12', recipients: [] })).toEqual([])
  })
  it('deletes extra old messages when a roster gets shorter', async () => {
    const calls = []
    const fetchFn = vi.fn(async (url, init) => {
      calls.push(init.method)
      return new Response(init.method === 'DELETE' ? null : JSON.stringify({ id: '123456789012345678' }), {
        status: init.method === 'DELETE' ? 204 : 200,
      })
    })
    const checkpoint = vi.fn()
    const ids = await deliverMessages(HOOK, ['One'], ['123456789012345678', '123456789012345679'], {
      fetchFn,
      checkpoint,
    })
    expect(calls).toEqual(['PATCH', 'DELETE'])
    expect(ids).toEqual(['123456789012345678'])
    expect(checkpoint).toHaveBeenLastCalledWith(['123456789012345678'])
  })
  it('refuses a URL that is not a Discord webhook', async () => {
    await expect(
      deliverMessages('https://example.com/hook', ['x'], [], { fetchFn: vi.fn(), checkpoint: vi.fn() }),
    ).rejects.toThrow('Reconnect the Discord channel')
  })
  it('player names cannot become links or break calendar lines', () => {
    const [message] = rosterMessages({
      guildName: 'Guild',
      raidName: 'Raid',
      start: 1791835200000,
      team: [{ name: '[Free nitro](https://evil.example) discord.gg/x', role: 'DPS' }],
    })
    expect(message).not.toContain('](')
    expect(message).not.toContain('https://')
    expect(message).not.toContain('discord.gg')
    const calendar = personalCalendar([
      {
        guild_id: 'g',
        week: '2026-10-12',
        raid_id: 'raid-a',
        member_id: 'm',
        start_ms: 1791835200000,
        end_ms: 1791842400000,
        sequence: 1,
        title: 'Raid\rX-INJECTED:1',
        description: 'ok',
        cancelled: false,
        updated_at: '2026-10-11T00:00:00Z',
      },
    ])
    expect(calendar).not.toMatch(/\rX-INJECTED/)
  })
})
