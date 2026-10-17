// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { Buffer } from 'node:buffer'
import {
  RAID_COMMAND,
  parseRaidCommand,
  raidCommandReply,
  registerRaidCommand,
} from '../../supabase/functions/_shared/discord-commands.js'
import {
  handleDiscordInteraction,
  editOriginalResponse,
} from '../../supabase/functions/_shared/discord-interactions.js'
import { signupReadiness, readinessText } from '../../supabase/functions/_shared/raid-readiness.js'

const APP = '123456789012345678',
  SERVER = '223456789012345678',
  CHANNEL = '323456789012345678',
  USER = '423456789012345678'
const APP_URL = 'https://example.com/app/'
const NOW = 1792000000000
const command = (name = 'next', options = []) => ({
  type: 2,
  id: '523456789012345678',
  application_id: APP,
  guild_id: SERVER,
  channel_id: CHANNEL,
  member: { user: { id: USER } },
  token: 'interaction-secret',
  data: { name: 'raid', type: 1, options: [{ type: 1, name, options }] },
})
const event = (overrides = {}) => ({
  week: '2026-10-12',
  raidId: 'raid-20',
  raidName: 'Blackwing Lair',
  start: NOW + 86400000,
  end: NOW + 97200000,
  targets: [1, 1, 2],
  published: false,
  mine: {},
  signups: [],
  signupMessageId: '623456789012345678',
  ...overrides,
})
const overview = (raids = [event()], overrides = {}) => ({
  outcome: 'ok',
  guildId: '00000000-0000-4000-8000-000000000001',
  guildName: 'Night Shift',
  serverId: SERVER,
  channelId: CHANNEL,
  officer: false,
  raids,
  ...overrides,
})
const textOf = (value) => JSON.stringify(value)
let keys, publicKey
beforeAll(async () => {
  keys = await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  publicKey = Buffer.from(await webcrypto.subtle.exportKey('raw', keys.publicKey)).toString('hex')
})
async function request(body) {
  const raw = JSON.stringify(body),
    timestamp = String(NOW / 1000)
  const signature = Buffer.from(
    await webcrypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(timestamp + raw)),
  ).toString('hex')
  return new Request('https://test/raid-interactions', {
    method: 'POST',
    body: raw,
    headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
  })
}

describe('raid command boundary', () => {
  it('accepts only server commands with signed membership identity and known options', () => {
    expect(parseRaidCommand(command('upcoming', [{ name: 'page', type: 4, value: 2 }]))).toEqual({
      name: 'upcoming',
      page: 2,
      args: { p_discord_id: USER, p_discord_guild_id: SERVER, p_channel_id: CHANNEL },
    })
    for (const bad of [
      { ...command(), guild_id: null },
      { ...command(), member: null, user: { id: USER } },
      command('delete'),
      command('constructor'),
      command('help', [{ name: 'page', type: 4, value: 1 }]),
      command('mine', [{ name: 'page', type: 4, value: 0 }]),
      command('mine', [{ name: 'page', type: 4, value: 11 }]),
      command('mine', [{ name: 'page', type: 4, value: 1.5 }]),
      command('mine', [{ name: 'user', type: 3, value: USER }]),
      { ...command(), data: { ...command().data, options: [] } },
      { ...command(), data: { ...command().data, options: [null] } },
      command('mine', [null]),
    ])
      expect(parseRaidCommand(bad)).toBeNull()
  })

  it('acknowledges privately before the database resolves, then answers with signed identity only', async () => {
    let resolve
    const rpc = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const work = [],
      followup = vi.fn()
    const response = await handleDiscordInteraction(await request(command()), {
      publicKey,
      applicationId: APP,
      appUrl: APP_URL,
      now: NOW,
      rpc,
      followup,
      schedule: (p) => work.push(p),
    })
    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } })
    expect(followup).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('discord_raid_overview', {
      p_discord_id: USER,
      p_discord_guild_id: SERVER,
      p_channel_id: CHANNEL,
    })
    resolve(overview())
    await Promise.all(work)
    expect(textOf(followup.mock.calls[0][1])).toContain('Blackwing Lair')
  })

  it('handles help without storage and gives a safe error on database failures', async () => {
    for (const name of ['help', 'mine']) {
      const rpc = vi.fn().mockRejectedValue(new Error('private database detail'))
      const work = [],
        followup = vi.fn()
      await handleDiscordInteraction(await request(command(name)), {
        publicKey,
        applicationId: APP,
        appUrl: APP_URL,
        now: NOW,
        rpc,
        followup,
        schedule: (p) => work.push(p),
      })
      await Promise.all(work)
      expect(textOf(followup.mock.calls)).not.toContain('private database detail')
      expect(rpc).toHaveBeenCalledTimes(name === 'help' ? 0 : 1)
      expect(textOf(followup.mock.calls)).toContain(name === 'help' ? '/raid next' : 'could not be loaded')
    }
  })

  it('does not schedule malformed or unsigned commands', async () => {
    const rpc = vi.fn(),
      schedule = vi.fn()
    const config = { publicKey, applicationId: APP, now: NOW, rpc, schedule }
    expect(
      (
        await handleDiscordInteraction(
          new Request('https://test', { method: 'POST', body: JSON.stringify(command()) }),
          config,
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await handleDiscordInteraction(
          await request(command('mine', [{ name: 'page', type: 4, value: -1 }])),
          config,
        )
      ).status,
    ).toBe(400)
    expect(schedule).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('upserts only /raid in the verified server and does not bulk delete commands', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }))
    await registerRaidCommand({ applicationId: APP, serverId: SERVER, botToken: 'secret', fetchFn })
    expect(fetchFn).toHaveBeenCalledWith(
      `https://discord.com/api/v10/applications/${APP}/guilds/${SERVER}/commands`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual(RAID_COMMAND)
    expect(RAID_COMMAND.options.map((entry) => entry.name)).toEqual([
      'next',
      'upcoming',
      'mine',
      'roster',
      'readiness',
      'help',
    ])
    fetchFn.mockResolvedValue(new Response('{}', { status: 429 }))
    await expect(
      registerRaidCommand({ applicationId: APP, serverId: SERVER, botToken: 'secret', fetchFn }),
    ).rejects.toThrow(/rate limiting/)
  })
})

describe('raid command cards', () => {
  it('distinguishes signup bench from published roster confirmation and links back to the actual posts', () => {
    const before = raidCommandReply(
      { name: 'mine' },
      overview([
        event({
          mine: {
            status: 'signed',
            character: 'Oak',
            spec: 'Feral Combat',
            role: 'Tank',
            bench: true,
            place: 3,
          },
        }),
      ]),
      APP_URL,
    )
    expect(textOf(before)).toContain('Signup bench')
    const after = raidCommandReply(
      { name: 'mine' },
      overview([
        event({
          published: true,
          rosterMessageId: '723456789012345678',
          mine: {
            rostered: true,
            response: 'confirmed',
            rosterCharacter: 'Oak',
            rosterRole: 'Tank',
            status: 'signed',
            bench: true,
          },
        }),
      ]),
      APP_URL,
    )
    expect(textOf(after)).toContain('Roster confirmed')
    expect(textOf(after)).not.toContain('Signup bench')
    expect(textOf(after)).toContain(`https://discord.com/channels/${SERVER}/${CHANNEL}/723456789012345678`)
    expect(textOf(after)).toContain(
      `?guild=00000000-0000-4000-8000-000000000001#/published/2026-10-12/raid-20`,
    )
  })

  it('keeps other members out of readiness and surfaces actionable officer counts', () => {
    const raid = event({
      published: true,
      targets: [1, 1, 2],
      rosterTargets: [2, 2, 2],
      rosterCounts: [1, 1, 2],
      confirmed: 1,
      tentative: 1,
      unconfirmed: 2,
      unavailable: 1,
    })
    expect(textOf(raidCommandReply({ name: 'readiness' }, overview([raid]), APP_URL))).toContain(
      'Only WhenToRaid officers',
    )
    const report = textOf(
      raidCommandReply({ name: 'readiness' }, overview([raid], { officer: true }), APP_URL),
    )
    expect(report).toContain('Published roster needs 1 tank, 1 healer')
    expect(report).toContain("1 confirmed · 1 tentative · 2 awaiting confirmation · 1 can't attend")
    expect(report).toContain('#/planner/2026-10-12/raid-20')
  })

  it('paginates without losing raids and filters mine before paging', () => {
    const raids = Array.from({ length: 12 }, (_, i) =>
      event({ raidName: `Raid ${i}`, mine: i % 2 ? { status: 'tentative' } : {} }),
    )
    expect(
      raidCommandReply({ name: 'upcoming', page: 2 }, overview(raids), APP_URL).embeds[0].fields.map(
        (f) => f.name,
      ),
    ).toEqual(['#6 · Raid 5', '#7 · Raid 6', '#8 · Raid 7', '#9 · Raid 8', '#10 · Raid 9'])
    const mine = raidCommandReply({ name: 'mine', page: 2 }, overview(raids), APP_URL)
    expect(mine.embeds[0].fields.map((f) => f.name)).toEqual(['#12 · Raid 11'])
    expect(textOf(raidCommandReply({ name: 'mine', page: 3 }, overview(raids), APP_URL))).toContain(
      'There are 2 pages',
    )
    expect(raidCommandReply({ name: 'next' }, overview(raids), APP_URL).embeds[0].fields).toHaveLength(1)
  })

  it('explains empty, unlinked and ambiguous guilds without exposing data', () => {
    expect(textOf(raidCommandReply({ name: 'mine' }, overview([]), APP_URL))).toContain('No signups')
    expect(textOf(raidCommandReply({ name: 'upcoming' }, { outcome: 'ambiguous' }, APP_URL))).toContain(
      'connected bot channel',
    )
    expect(textOf(raidCommandReply({ name: 'next' }, { outcome: 'not-member' }, APP_URL))).toContain(
      'invite link',
    )
  })

  it('escapes user text, bounds embeds, and suppresses mentions in the transport', async () => {
    const raids = Array.from({ length: 5 }, () =>
      event({
        raidName: '@everyone**'.repeat(15),
        mine: {
          status: 'signed',
          character: '*'.repeat(30),
          spec: '*'.repeat(40),
          role: 'DPS',
          afterDeadline: true,
        },
      }),
    )
    const message = raidCommandReply({ name: 'upcoming' }, overview(raids), APP_URL)
    const embed = message.embeds[0]
    expect(textOf(embed)).not.toContain('@everyone')
    expect(embed.fields.every((field) => field.name.length <= 256 && field.value.length <= 1024)).toBe(true)
    const size =
      embed.title.length +
      embed.description.length +
      embed.footer.text.length +
      embed.fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0)
    expect(size).toBeLessThanOrEqual(6000)
    const fetchFn = vi.fn(async () => new Response('{}'))
    await editOriginalResponse(command(), message, fetchFn)
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).allowed_mentions).toEqual({ parse: [] })
    expect(() => raidCommandReply({ name: 'next' }, overview(), 'http://example.com')).toThrow(/HTTPS/)
  })
})

describe('honest signup readiness', () => {
  it('does not fill a healer gap with benched tanks, tentative players, or unknown roles', () => {
    const summary = signupReadiness(
      [
        { role: 'Tank', status: 'late' },
        { role: 'Tank', status: 'signed' },
        { role: 'Healer', status: 'tentative' },
        { status: 'signed' },
        { role: 'DPS', status: 'absent' },
      ],
      [1, 1, 1],
    )
    expect(summary).toMatchObject({ needed: '1 healer, 1 DPS', late: 1, tentative: 1, bench: 1, unknown: 1 })
    expect(readinessText(summary)).toContain('1 slotted player arrives late')
    expect(readinessText(summary)).toContain('not counted toward role targets')
    expect(readinessText(signupReadiness([], [0, 0, 0]))).toBe('No role targets set.')
  })
})
