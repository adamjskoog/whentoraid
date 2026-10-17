// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import {
  handleDiscordInteraction,
  signupComponents,
  signupReply,
} from '../../supabase/functions/_shared/discord-interactions.js'
import { signupMessages } from '../../supabase/functions/_shared/signup-post.js'
import { signupLineup } from '../../supabase/functions/_shared/signup-lineup.js'
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

/** The single card a sign-up post sends. */
function card(data) {
  const messages = signupMessages(data)
  expect(messages).toHaveLength(1)
  expect(messages[0].content).toBe('')
  return messages[0].embeds[0]
}
const fieldNamed = (embed, prefix) => embed.fields.find((field) => field.name.startsWith(prefix))
const embedSize = (embed) =>
  [embed.title, embed.description, embed.author?.name, embed.footer?.text]
    .concat(embed.fields.flatMap((field) => [field.name, field.value]))
    .reduce((sum, text) => sum + (text?.length ?? 0), 0)

describe('sign-up lineup', () => {
  it('fills each role in sign-up order up to its target and benches the rest', () => {
    const lineup = signupLineup(
      [
        signup('Thrall', 'Tank', 'signed'),
        signup('Garrosh', 'Tank', 'late'),
        signup('Jaina', 'DPS', 'tentative'),
        signup('Saurfang', 'Tank', 'signed'),
        signup('Anduin', 'Healer', 'signed'),
        signup('Feral', null, 'signed'),
        signup('Sylvanas', null, 'absent'),
      ],
      [2, 1, 0],
    )
    expect(lineup.roles.map((r) => [r.role, r.target, r.members.map((m) => [m.name, m.number])])).toEqual([
      [
        'Tank',
        2,
        [
          ['Thrall', 1],
          ['Garrosh', 2],
        ],
      ],
      ['Healer', 1, [['Anduin', 4]]],
      ['DPS', 0, []],
    ])
    expect(lineup.bench.map((m) => [m.name, m.number])).toEqual([['Saurfang', 3]])
    expect(lineup.other.map((m) => m.name)).toEqual(['Feral'])
    expect(lineup.tentative.map((m) => m.name)).toEqual(['Jaina'])
    expect(lineup.absent.map((m) => m.name)).toEqual(['Sylvanas'])
    expect(lineup.coming).toBe(5)
  })

  it('never benches a role whose target is 0 or missing', () => {
    const many = Array.from({ length: 5 }, (_, i) => signup(`Rogue${i}`, 'DPS', 'signed'))
    expect(signupLineup(many, [1, 1, 0]).bench).toEqual([])
    expect(signupLineup(many).bench).toEqual([])
  })
})

describe('sign-up posts', () => {
  it('shows a card with the raid time, role columns numbered in sign-up order, and who is unsure or away', () => {
    const embed = card(
      payload({
        signups: [
          signup('Thrall', 'Tank', 'signed'),
          signup('Anduin', 'Healer', 'signed', { class: 'Priest', spec: 'Holy' }),
          signup('Varian', 'DPS', 'late', { class: 'Warrior', spec: 'Fury' }),
          signup('Jaina', 'DPS', 'tentative', { class: 'Mage', spec: 'Frost' }),
          signup('Sylvanas', null, 'absent', { class: null, spec: null }),
        ],
      }),
    )
    expect(embed.author.name).toBe('Unsanction Raid')
    expect(embed.title).toBe('20-player Raid')
    expect(embed.timestamp).toBe(new Date(START).toISOString())
    expect(embed.description).toContain(`<t:${START / 1000}:F>`)
    expect(embed.description).toContain(`<t:${START / 1000}:R>`)
    expect(embed.description).toContain(
      '🛡️ Tanks **1**/2 · 💚 Healers **1**/4 · ⚔️ DPS **1**/14 · **3** signed up',
    )
    expect(fieldNamed(embed, '🛡️ Tanks')).toMatchObject({
      name: '🛡️ Tanks (1/2)',
      value: '`1` 🟫 **Thrall** Protection',
      inline: true,
    })
    expect(fieldNamed(embed, '💚 Healers').value).toBe('`2` ⬜ **Anduin** Holy')
    expect(fieldNamed(embed, '⚔️ DPS').value).toBe('`3` 🟫 **Varian** Fury · late')
    expect(fieldNamed(embed, '❔ Tentative').value).toBe('Jaina')
    expect(fieldNamed(embed, '❌ Absent').value).toBe('Sylvanas')
    expect(embed.color).toBe(0x57f287)
  })

  it('puts players past a full role on the bench with their role shown', () => {
    const embed = card(
      payload({
        targets: [1, 1, 1],
        signups: [signup('Thrall', 'Tank', 'signed'), signup('Garrosh', 'Tank', 'signed')],
      }),
    )
    expect(embed.description).toContain('🪑 1 on the bench')
    expect(fieldNamed(embed, '🛡️ Tanks').value).toContain('Thrall')
    expect(fieldNamed(embed, '🪑 Bench')).toMatchObject({
      name: '🪑 Bench (1)',
      value: '`2` 🟫 **Garrosh** Protection Tank',
      inline: false,
    })
  })

  it('says when there are no sign-ups yet, and when the roster is published, cancelled or closed', () => {
    expect(card(payload()).description).toContain('No sign-ups yet.')
    expect(card(payload()).fields.map((field) => field.name)).toEqual([
      '🪑 Bench (0)',
      '❔ Tentative (0)',
      '❌ Absent (0)',
    ])
    const published = card(payload({ published: true }))
    expect(published.description).toContain('Roster published')
    expect(published.color).toBe(0x5865f2)
    const cancelled = card(payload({ cancelled: true, closed: true }))
    expect(cancelled.description).toBe('**This raid has been cancelled.**')
    expect(cancelled.color).toBe(0xed4245)
    const closed = card(payload({ closed: true }))
    expect(closed.footer.text).toBe('Sign-ups are closed')
    expect(closed.color).toBe(0x99aab5)
  })

  it('escapes player-chosen names and never pings anyone', () => {
    const embed = card(
      payload({ signups: [signup('@everyone', 'Tank', 'signed')], guildName: 'Foo (EU)\nRaid' }),
    )
    const text = JSON.stringify(embed)
    expect(text).not.toContain('@everyone')
    expect(text).not.toMatch(/<@\d/)
    expect(embed.author.name).toBe('Foo (EU) Raid')
  })

  it('keeps a very long sign-up list inside Discord embed limits', () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      signup(
        `Raider${i}${'x'.repeat(20)}`,
        ['Tank', 'Healer', 'DPS', null][i % 4],
        ['signed', 'tentative', 'absent'][i % 3],
        {
          class: 'Rogue',
          spec: 'Combat',
        },
      ),
    )
    const messages = signupMessages(payload({ targets: [2, 4, 14], signups: many }))
    expect(messages.length).toBeGreaterThan(1)
    for (const {
      embeds: [embed],
    } of messages) {
      expect(embed.fields.length).toBeLessThanOrEqual(25)
      for (const field of embed.fields) {
        expect(field.value.length).toBeLessThanOrEqual(1024)
        expect(field.value.length).toBeGreaterThan(0)
      }
      expect(embedSize(embed)).toBeLessThanOrEqual(6000)
    }
    const allText = JSON.stringify(messages)
    for (const player of many) expect(allText).toContain(player.name)
    expect(allText).not.toMatch(/…and \d+ more/)
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
    expect(row.components.slice(0, 4).map((c) => c.emoji.name)).toEqual(['✅', '⏰', '❔', '❌'])
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

  it('tells a player privately when their role is full and they are on the bench', async () => {
    const work = []
    const followup = vi.fn()
    const rpc = vi.fn(async (name) =>
      name === 'signup_from_discord'
        ? { outcome: 'saved', status: 'signed', raidName: 'Raid', character: 'Garrosh', guildId: GUILD }
        : { role: 'Tank', place: 3, target: 2, bench: true },
    )
    await handleDiscordInteraction(await signed(press('signed')), {
      publicKey,
      applicationId: APP,
      now: NOW,
      rpc,
      followup,
      schedule: (promise) => work.push(promise),
    })
    await Promise.all(work)
    expect(rpc).toHaveBeenCalledWith('signup_standing', { p_delivery_id: JOB, p_discord_id: USER })
    expect(followup.mock.calls[0][1].content).toBe(
      "You're signed up for Raid as Garrosh. The tank spots are full, so you're on the bench. Your officers decide who plays.",
    )
  })

  it('does not look up a standing for tentative or absent answers, and still confirms if the lookup fails', async () => {
    const tentative = await run(press('tentative'), { outcome: 'saved', status: 'tentative', guildId: GUILD })
    expect(tentative.rpc).toHaveBeenCalledTimes(1)

    const work = []
    const followup = vi.fn()
    const rpc = vi.fn(async (name) => {
      if (name === 'signup_standing') throw new Error('timeout')
      return { outcome: 'saved', status: 'late', raidName: 'Raid', guildId: GUILD }
    })
    await handleDiscordInteraction(await signed(press('late')), {
      publicKey,
      applicationId: APP,
      now: NOW,
      rpc,
      followup,
      schedule: (promise) => work.push(promise),
      log: () => {},
    })
    await Promise.all(work)
    expect(followup.mock.calls[0][1].content).toBe("You're signed up for Raid, arriving late.")
  })

  const DRUID_SPECS = [
    { spec: 'Balance', role: 'DPS' },
    { spec: 'Feral Combat', role: 'Tank' },
    { spec: 'Feral Combat', role: 'DPS' },
    { spec: 'Restoration', role: 'Healer' },
  ]
  const asDruid = (extra = {}) => ({
    outcome: 'saved',
    status: 'signed',
    raidName: 'Raid',
    character: 'Malfurion',
    class: 'Druid',
    spec: 'Restoration',
    role: 'Healer',
    specs: DRUID_SPECS,
    guildId: GUILD,
    ...extra,
  })
  const pickSpec = (value, message = POST) =>
    interaction(
      { component_type: 3, custom_id: `wtp:${JOB}:${message}`, values: [value] },
      { id: EPHEMERAL, author: { id: APP, bot: true } },
    )

  it('confirms the spec a player signed up as and offers to change it for this raid', () => {
    const reply = signupReply(asDruid(), { p_delivery_id: JOB, p_message_id: POST })
    expect(reply.content).toBe("You're signed up for Raid as Malfurion (Restoration Druid, Healer).")
    const [menu] = reply.components[0].components
    expect(menu.custom_id).toBe(`wtp:${JOB}:${POST}`)
    expect(menu.placeholder).toBe('Change spec for this raid')
    expect(menu.options.map((o) => [o.label, o.value, Boolean(o.default)])).toEqual([
      ['Balance · DPS', 'Balance|DPS', false],
      ['Feral Combat · Tank', 'Feral Combat|Tank', false],
      ['Feral Combat · DPS', 'Feral Combat|DPS', false],
      ['Restoration · Healer', 'Restoration|Healer', true],
    ])
  })

  it('offers no spec menu for absent answers or a sign-up without a character', () => {
    const args = { p_delivery_id: JOB, p_message_id: POST }
    expect(signupReply(asDruid({ status: 'absent' }), args).components).toEqual([])
    expect(signupReply({ outcome: 'saved', status: 'tentative', raidName: 'Raid' }, args).components).toEqual(
      [],
    )
  })

  it('records a spec chosen from the menu against the original post, then refreshes it', async () => {
    const { response, rpc, followup, refresh } = await run(
      pickSpec('Feral Combat|Tank'),
      asDruid({ spec: 'Feral Combat', role: 'Tank' }),
    )
    expect(await response.json()).toEqual({ type: 6 })
    expect(rpc).toHaveBeenCalledWith('signup_spec_from_discord', {
      p_interaction_id: '623456789012345679',
      p_discord_id: USER,
      p_discord_guild_id: SERVER,
      p_channel_id: CHANNEL,
      p_message_id: POST,
      p_delivery_id: JOB,
      p_spec: 'Feral Combat',
      p_role: 'Tank',
    })
    expect(rpc).toHaveBeenCalledWith('signup_standing', { p_delivery_id: JOB, p_discord_id: USER })
    const [, reply] = followup.mock.calls[0]
    expect(reply.content).toMatch(/as Malfurion \(Feral Combat Druid, Tank\)/)
    expect(reply.components[0].components[0].options.find((o) => o.default).value).toBe('Feral Combat|Tank')
    expect(refresh).toHaveBeenCalledWith(GUILD)
  })

  it('rejects malformed spec choices without touching storage', async () => {
    for (const payload of [
      pickSpec('Restoration'),
      pickSpec('Restoration|Support'),
      pickSpec(`${'x'.repeat(41)}|DPS`),
      pickSpec('Restoration|Healer', 'not-a-message'),
    ]) {
      const { response, rpc } = await run(payload, null)
      expect(response.status).toBe(400)
      expect(rpc).not.toHaveBeenCalled()
    }
  })

  it('explains why a spec could not be changed', () => {
    expect(signupReply({ outcome: 'not-signed' }).content).toMatch(/Sign up first/)
    expect(signupReply({ outcome: 'bad-spec' }).content).toMatch(/can't play that spec/)
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
    expect(body.content).toBe('')
    expect(JSON.stringify(body.embeds)).toContain('Thrall')
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
