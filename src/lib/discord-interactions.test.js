// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import {
  handleDiscordInteraction,
  rosterComponents,
  verifyDiscordSignature,
} from '../../supabase/functions/_shared/discord-interactions.js'
import { deliverMessages } from '../../supabase/functions/_shared/raid-service-core.js'

const APP = '123456789012345678'
const USER = '223456789012345678'
const CHANNEL = '323456789012345678'
const SERVER = '423456789012345678'
const MESSAGE = '523456789012345678'
const JOB = '00000000-0000-4000-8000-000000000001'
const NOW = 1792000000000
let keys, publicKey
const hex = (bytes) => Buffer.from(bytes).toString('hex')
beforeAll(async () => {
  keys = await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  publicKey = hex(await webcrypto.subtle.exportKey('raw', keys.publicKey))
})
async function signed(body, timestamp = String(NOW / 1000)) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const signature = hex(
    await webcrypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(timestamp + raw)),
  )
  return new Request('https://test/functions/v1/raid-interactions', {
    method: 'POST',
    body: raw,
    headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
  })
}
const click = (overrides = {}) => ({
  id: '623456789012345678',
  application_id: APP,
  type: 3,
  token: 'valid_interaction_token',
  guild_id: SERVER,
  channel_id: CHANNEL,
  member: { user: { id: USER } },
  message: { id: MESSAGE, author: { id: APP, bot: true } },
  data: { component_type: 2, custom_id: `wtr:${JOB}:2:confirmed` },
  ...overrides,
})
describe('signed Discord responses', () => {
  it('verifies timestamp plus exact body and rejects stale, malformed and tampered requests', async () => {
    const request = await signed({ type: 1, application_id: APP })
    const raw = await request.text()
    const args = {
      publicKey,
      signature: request.headers.get('x-signature-ed25519'),
      timestamp: request.headers.get('x-signature-timestamp'),
      body: raw,
      now: NOW,
    }
    expect(await verifyDiscordSignature(args)).toBe(true)
    expect(await verifyDiscordSignature({ ...args, body: raw + ' ' })).toBe(false)
    expect(await verifyDiscordSignature({ ...args, now: NOW + 301000 })).toBe(false)
    expect(await verifyDiscordSignature({ ...args, now: NOW - 301000 })).toBe(false)
    expect(await verifyDiscordSignature({ ...args, signature: 'zz'.repeat(64) })).toBe(false)
  })
  it('requires signatures for PING and rejects another application before scheduling any work', async () => {
    const schedule = vi.fn()
    const config = { publicKey, applicationId: APP, now: NOW, schedule }
    expect(
      await (await handleDiscordInteraction(await signed({ type: 1, application_id: APP }), config)).json(),
    ).toEqual({ type: 1 })
    expect(
      (await handleDiscordInteraction(new Request('https://test', { method: 'POST', body: '{}' }), config))
        .status,
    ).toBe(401)
    expect(
      (await handleDiscordInteraction(await signed(click({ application_id: USER })), config)).status,
    ).toBe(401)
    expect(schedule).not.toHaveBeenCalled()
  })
  it('defers privately, uses only signed identity and message coordinates, then acknowledges the stored result', async () => {
    const work = []
    const rpc = vi.fn().mockResolvedValue({ outcome: 'saved', status: 'confirmed' })
    const followup = vi.fn()
    const response = await handleDiscordInteraction(await signed(click()), {
      publicKey,
      applicationId: APP,
      now: NOW,
      rpc,
      followup,
      schedule: (promise) => work.push(promise),
    })
    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } })
    await Promise.all(work)
    expect(rpc).toHaveBeenCalledWith('respond_to_discord_raid', {
      p_interaction_id: '623456789012345678',
      p_discord_id: USER,
      p_discord_guild_id: SERVER,
      p_channel_id: CHANNEL,
      p_message_id: MESSAGE,
      p_delivery_id: JOB,
      p_version: 2,
      p_status: 'confirmed',
    })
    expect(followup).toHaveBeenCalledWith(expect.any(Object), expect.stringMatching(/confirmed/i))
  })
  it('rejects DM, non-bot messages and malformed components without touching storage', async () => {
    const rpc = vi.fn(),
      schedule = vi.fn()
    for (const payload of [
      click({ guild_id: null }),
      click({ member: null }),
      click({ message: { id: MESSAGE, author: { id: USER } } }),
      click({ data: { component_type: 2, custom_id: `wtr:${JOB}:2:delete` } }),
    ]) {
      const response = await handleDiscordInteraction(await signed(payload), {
        publicKey,
        applicationId: APP,
        now: NOW,
        rpc,
        schedule,
      })
      expect(response.status).toBe(400)
    }
    expect(rpc).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
  })
})
describe('application-authored roster posts', () => {
  const job = { id: JOB, version: 2, guild_id: JOB, week: '2026-10-12', raid_id: 'raid-20', payload: {} }
  it('binds response buttons to delivery version and adds a guild-aware published roster link', () => {
    const [row] = rosterComponents(job, 'https://whentoraid.example/app/')
    expect(row.components.map((c) => c.label)).toEqual(['Confirm', "Can't attend", 'View roster'])
    expect(row.components[0].custom_id).toBe(`wtr:${JOB}:2:confirmed`)
    expect(row.components[0].custom_id.length).toBeLessThanOrEqual(100)
    expect(row.components[2].url).toBe(
      `https://whentoraid.example/app/?guild=${JOB}#/published/2026-10-12/raid-20`,
    )
    expect(rosterComponents({ ...job, payload: { cancelled: true } }, 'https://whentoraid.example')).toEqual(
      [],
    )
    expect(rosterComponents({ ...job, payload: { withdrawn: true } }, 'https://whentoraid.example')).toEqual(
      [],
    )
    expect(() => rosterComponents(job, 'http://evil.example')).toThrow(/HTTPS/)
  })
  it('posts and updates bot messages using the bot endpoint, clearing obsolete controls without repinging', async () => {
    const calls = [],
      checkpoint = vi.fn()
    const fetchFn = vi.fn(async (url, init) => {
      calls.push({ url, ...init })
      return new Response(JSON.stringify({ id: MESSAGE }), { status: 200 })
    })
    const target = { type: 'bot', channelId: CHANNEL, token: 'server-secret' }
    await deliverMessages(target, ['Roster'], [], {
      fetchFn,
      checkpoint,
      components: rosterComponents(job, 'https://example.com'),
      mentionIds: [USER],
    })
    await deliverMessages(target, ['Cancelled'], [MESSAGE], {
      fetchFn,
      checkpoint,
      components: [],
      mentionIds: [USER],
    })
    expect(calls[0].url).toBe(`https://discord.com/api/v10/channels/${CHANNEL}/messages`)
    expect(calls[0].headers.Authorization).toBe('Bot server-secret')
    expect(JSON.parse(calls[0].body).components[0].components).toHaveLength(3)
    expect(calls[1].method).toBe('PATCH')
    expect(JSON.parse(calls[1].body)).toMatchObject({ components: [], allowed_mentions: { users: [] } })
    expect(checkpoint).toHaveBeenCalledWith([MESSAGE])
  })
})
