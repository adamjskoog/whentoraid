// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import {
  handleDiscordInteraction,
  signupComponents,
  signupReply,
} from '../../supabase/functions/_shared/discord-interactions.js'
import { signupMessages } from '../../supabase/functions/_shared/raid-service-core.js'
import { deliverQueued } from '../../supabase/functions/_shared/delivery-worker.js'

const APP = '123456789012345678'
const USER = '223456789012345678'
const CHANNEL = '323456789012345678'
const SERVER = '423456789012345678'
const POST = '523456789012345678'
const EPHEMERAL = '533456789012345678'
const JOB = '00000000-0000-4000-8000-000000000002'
const GUILD = '00000000-0000-4000-8000-0000000000aa'
const NOW = 1792000000000
const START = 1792400000000

let keys, publicKey
const hex = (bytes) => Buffer.from(bytes).toString('hex')
beforeAll(async () => {
  keys = await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  publicKey = hex(await webcrypto.subtle.exportKey('raw', keys.publicKey))
})
async function signed(body) {
  const raw = JSON.stringify(body)
  const timestamp = String(NOW / 1000)
  const signature = hex(
    await webcrypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(timestamp + raw)),
  )
  return new Request('https://test/functions/v1/raid-interactions', {
    method: 'POST',
    body: raw,
    headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
  })
}
const interaction = (data, message = { id: POST, author: { id: APP, bot: true } }) => ({
  id: '623456789012345679',
  application_id: APP,
  type: 3,
  token: 'valid_interaction_token',
  guild_id: SERVER,
  channel_id: CHANNEL,
  member: { user: { id: USER } },
  message,
  data,
})
const press = (status) => interaction({ component_type: 2, custom_id: `wts:${JOB}:${status}` })
const choose = (status, characterId) =>
  interaction(
    { component_type: 3, custom_id: `wtc:${JOB}:${POST}:${status}`, values: [characterId] },
    { id: EPHEMERAL, author: { id: APP, bot: true } },
  )

async function run(payload, rpcResult) {
  const work = []
  const rpc = vi.fn().mockResolvedValue(rpcResult)
  const followup = vi.fn()
  const refresh = vi.fn().mockResolvedValue(undefined)
  const response = await handleDiscordInteraction(await signed(payload), {
    publicKey,
    applicationId: APP,
    now: NOW,
    rpc,
    followup,
    refresh,
    schedule: (promise) => work.push(promise),
  })
  await Promise.all(work)
  return { response, rpc, followup, refresh }
}

const payload = (overrides = {}) => ({
  guildId: GUILD,
  week: '2026-10-26',
  raidId: 'raid-20',
  guildName: 'Unsanction Raid',
  raidName: '20-player Raid',
  start: START,
  end: START + 10800000,
  targets: [2, 4, 14],
  cancelled: false,
  published: false,
  closed: false,
  signups: [],
  ...overrides,
})
const signup = (name, role, status, extra = {}) => ({
  name,
  player: name,
  class: 'Warrior',
  spec: 'Protection',
  role,
  status,
  discordId: '',
  ...extra,
})

describe('sign-up posts', () => {
  it('lists sign-ups by role with counts against the raid targets, numbered in sign-up order', () => {
    const text = signupMessages(
      payload({
        signups: [
          signup('Thrall', 'Tank', 'signed'),
          signup('Anduin', 'Healer', 'signed', { class: 'Priest', spec: 'Holy' }),
          signup('Varian', 'DPS', 'late', { class: 'Warrior', spec: 'Fury' }),
          signup('Jaina', 'DPS', 'tentative', { class: 'Mage', spec: 'Frost' }),
          signup('Sylvanas', null, 'absent', { class: null, spec: null }),
        ],
      }),
    ).join('\n')
    expect(text).toContain('**Unsanction Raid · 20-player Raid**')
    expect(text).toContain(`<t:${START / 1000}:F> (<t:${START / 1000}:R>)`)
    expect(text).toContain('Tanks 1/2 · Healers 1/4 · DPS 1/14 · 3 signed up')
    expect(text).toMatch(/Tanks \(1\)\*\*\n1\. Thrall — Protection Warrior/)
    expect(text).toMatch(/Healers \(1\)\*\*\n2\. Anduin — Holy Priest/)
    expect(text).toMatch(/3\. Varian — Fury Warrior · late/)
    expect(text).toContain('**Tentative (1):** Jaina')
    expect(text).toContain('**Absent (1):** Sylvanas')
  })

  it('says when there are no sign-ups yet, and when the roster is published, cancelled or closed', () => {
    expect(signupMessages(payload()).join('\n')).toContain('No sign-ups yet.')
    expect(signupMessages(payload({ published: true })).join('\n')).toContain('Roster published')
    expect(signupMessages(payload({ cancelled: true, closed: true })).join('\n')).toContain(
      '**This raid has been cancelled.**',
    )
    expect(signupMessages(payload({ closed: true })).join('\n')).toContain('Sign-ups are closed.')
  })

  it('escapes player-chosen names and never pings anyone', () => {
    const text = signupMessages(payload({ signups: [signup('@everyone', 'Tank', 'signed')] })).join('\n')
    expect(text).not.toContain('@everyone')
    expect(text).not.toMatch(/<@\d/)
  })

  it('splits a very long sign-up list into messages Discord accepts', () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      signup(`Raider${i}${'x'.repeat(20)}`, 'DPS', 'signed', { class: 'Rogue', spec: 'Combat' }),
    )
    const messages = signupMessages(payload({ signups: many }))
    expect(messages.length).toBeGreaterThan(1)
    for (const message of messages) expect(message.length).toBeLessThanOrEqual(2000)
  })

  it('offers four sign-up buttons and a link, and none once the raid is closed or cancelled', () => {
    const job = { id: JOB, guild_id: GUILD, week: '2026-10-26', raid_id: 'raid-20' }
    const [row] = signupComponents(job, payload(), 'https://whentoraid.example/app/')
    expect(row.components.map((c) => c.label)).toEqual([
      'Sign up',
      'Late',
      'Tentative',
      'Absent',
      'Open in WhenToRaid',
    ])
    expect(row.components[0].custom_id).toBe(`wts:${JOB}:signed`)
    expect(row.components.at(-1).url).toBe(
      `https://whentoraid.example/app/?guild=${GUILD}#/availability/2026-10-26`,
    )
    expect(signupComponents(job, payload({ closed: true }), 'https://whentoraid.example')).toEqual([])
    expect(signupComponents(job, payload({ cancelled: true }), 'https://whentoraid.example')).toEqual([])
    expect(() => signupComponents(job, payload(), 'http://evil.example')).toThrow(/HTTPS/)
  })
})

describe('sign-up presses', () => {
  it('records a button press with the signed identity and the post it was pressed on', async () => {
    const { response, rpc, followup, refresh } = await run(press('signed'), {
      outcome: 'saved',
      status: 'signed',
      raidName: '20-player Raid',
      character: 'Thrall',
      guildId: GUILD,
    })
    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } })
    expect(rpc).toHaveBeenCalledWith('signup_from_discord', {
      p_interaction_id: '623456789012345679',
      p_discord_id: USER,
      p_discord_guild_id: SERVER,
      p_channel_id: CHANNEL,
      p_message_id: POST,
      p_delivery_id: JOB,
      p_status: 'signed',
      p_character_id: null,
    })
    expect(followup).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ content: expect.stringMatching(/signed up for 20-player Raid as Thrall/) }),
    )
    expect(refresh).toHaveBeenCalledWith(GUILD)
  })

  it('asks a player with several characters to choose, then records the choice against the original post', async () => {
    const first = await run(press('late'), {
      outcome: 'choose',
      status: 'late',
      characters: [
        { id: 'c-mage', name: 'Starfall', class: 'Mage', spec: 'Frost', role: 'DPS' },
        { id: 'c-priest', name: 'Hallow', class: 'Priest', spec: 'Holy', role: 'Healer' },
      ],
    })
    const [, reply] = first.followup.mock.calls[0]
    const [menu] = reply.components[0].components
    expect(menu.type).toBe(3)
    expect(menu.custom_id).toBe(`wtc:${JOB}:${POST}:late`)
    expect(menu.options.map((o) => [o.label, o.value])).toEqual([
      ['Starfall — Frost Mage', 'c-mage'],
      ['Hallow — Holy Priest', 'c-priest'],
    ])
    expect(first.refresh).not.toHaveBeenCalled()

    const second = await run(choose('late', 'c-priest'), { outcome: 'saved', status: 'late', guildId: GUILD })
    expect(second.rpc).toHaveBeenCalledWith(
      'signup_from_discord',
      expect.objectContaining({ p_message_id: POST, p_status: 'late', p_character_id: 'c-priest' }),
    )
    expect(second.followup).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ components: [] }),
    )
  })

  it('rejects malformed sign-up components without touching storage', async () => {
    for (const payload of [
      interaction({ component_type: 2, custom_id: `wts:${JOB}:maybe` }),
      interaction({ component_type: 3, custom_id: `wts:${JOB}:signed`, values: ['c-1'] }),
      interaction({ component_type: 3, custom_id: `wtc:${JOB}:${POST}:signed`, values: [] }),
      interaction({ component_type: 3, custom_id: `wtc:${JOB}:${POST}:signed`, values: ['x'.repeat(65)] }),
      interaction({ component_type: 2, custom_id: `wts:${JOB}:signed` }, { id: POST, author: { id: USER } }),
    ]) {
      const { response, rpc } = await run(payload, null)
      expect(response.status).toBe(400)
      expect(rpc).not.toHaveBeenCalled()
    }
  })

  it('explains every outcome privately', () => {
    expect(signupReply({ outcome: 'saved', status: 'tentative', raidName: 'Raid' }).content).toMatch(
      /tentative/,
    )
    expect(signupReply({ outcome: 'saved', status: 'absent', raidName: 'Raid' }).content).toMatch(/absent/)
    expect(
      signupReply({ outcome: 'saved', status: 'signed', raidName: 'Raid', afterDeadline: true }).content,
    ).toMatch(/deadline/)
    expect(signupReply({ outcome: 'not-member', guildName: 'Unsanction Raid' }).content).toMatch(
      /Unsanction Raid.*invite/,
    )
    expect(signupReply({ outcome: 'no-characters' }).content).toMatch(/Add a character/)
    expect(signupReply({ outcome: 'closed' }).content).toMatch(/closed/)
    expect(signupReply(null).content).toMatch(/could not be saved/)
  })

  it('still replies when refreshing the post fails', async () => {
    const work = []
    const followup = vi.fn()
    await handleDiscordInteraction(await signed(press('absent')), {
      publicKey,
      applicationId: APP,
      now: NOW,
      rpc: vi.fn().mockResolvedValue({ outcome: 'saved', status: 'absent', guildId: GUILD }),
      followup,
      refresh: vi.fn().mockRejectedValue(new Error('Discord is down')),
      schedule: (promise) => work.push(promise),
      log: () => {},
    })
    await Promise.all(work)
    expect(followup).toHaveBeenCalledTimes(1)
  })
})

describe('the delivery worker', () => {
  const claimed = (overrides = {}) => ({
    id: JOB,
    guild_id: GUILD,
    week: '2026-10-26',
    raid_id: 'raid-20',
    kind: 'signup',
    action: 'post',
    version: 3,
    lease_token: '00000000-0000-4000-8000-0000000000bb',
    message_ids: [POST],
    channel_id: CHANNEL,
    webhook_url: null,
    payload: {},
    ...overrides,
  })

  function worker(job, signupPayload) {
    const calls = []
    const jobs = [job]
    const rpc = vi.fn(async (name, args) => {
      calls.push([name, args])
      if (name === 'claim_discord_delivery') return jobs.shift() ?? null
      if (name === 'raid_signup_payload') return signupPayload
      return null
    })
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id: POST }), { status: 200 }))
    return { rpc, fetchFn, calls }
  }

  it('edits a sign-up post with the current sign-ups and its buttons', async () => {
    const { rpc, fetchFn, calls } = worker(
      claimed(),
      payload({ signups: [signup('Thrall', 'Tank', 'signed')] }),
    )
    const results = await deliverQueued({
      rpc,
      guildId: GUILD,
      botToken: 'bot-secret',
      appUrl: 'https://whentoraid.example/',
      checkChannel: vi.fn(),
      fetchFn,
    })
    expect(results).toEqual([{ id: JOB, status: 'sent' }])
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(`https://discord.com/api/v10/channels/${CHANNEL}/messages/${POST}`)
    const body = JSON.parse(init.body)
    expect(body.content).toContain('Thrall')
    expect(body.components[0].components[0].custom_id).toBe(`wts:${JOB}:signed`)
    expect(calls.find(([name]) => name === 'finish_discord_delivery')[1]).toMatchObject({
      p_id: JOB,
      p_version: 3,
      p_error: null,
    })
  })

  it('does not post a sign-up for a raid that already started', async () => {
    const { rpc, fetchFn } = worker(claimed({ message_ids: [] }), payload({ closed: true }))
    const results = await deliverQueued({
      rpc,
      guildId: GUILD,
      botToken: 'bot-secret',
      appUrl: 'https://whentoraid.example/',
      checkChannel: vi.fn(),
      fetchFn,
    })
    expect(results).toEqual([{ id: JOB, status: 'skipped' }])
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
