import { describe, expect, it } from 'vitest'
import { rosterLists, rosterPages, playerName } from '../../supabase/functions/_shared/discord-roster.js'
import { raidCommandReply, parseRaidCommand } from '../../supabase/functions/_shared/discord-commands.js'
import { signupMessages } from '../../supabase/functions/_shared/signup-post.js'
import { escapeDiscord, deliverMessages } from '../../supabase/functions/_shared/raid-service-core.js'

const player = (id, status = 'signed', role = 'Tank') => ({
  memberId: id,
  player: `Player ${id}`,
  name: `Character ${id}`,
  role,
  class: 'Warrior',
  spec: 'Protection',
  status,
})
const raid = (overrides = {}) => ({
  raidId: 'r1',
  raidName: 'Raid night',
  week: '2026-10-12',
  guildName: 'Guild',
  start: 1792000000000,
  end: 1792010000000,
  targets: [1, 1, 2],
  signups: [],
  ...overrides,
})
const overview = (raids) => ({
  outcome: 'ok',
  guildId: '00000000-0000-4000-8000-000000000001',
  guildName: 'Guild',
  raids,
})
const size = (embed) =>
  [
    embed.author?.name,
    embed.title,
    embed.description,
    embed.footer?.text,
    ...embed.fields.flatMap((field) => [field.name, field.value]),
  ].reduce((sum, text) => sum + (text?.length ?? 0), 0)

describe('complete named raid lists', () => {
  it('lists the provisional roster, bench, tentative and absent names with character and player', () => {
    const data = raid({
      signups: [player('one'), player('two'), player('three', 'tentative'), player('four', 'absent')],
    })
    const { lists, pages } = rosterPages(data)
    expect(Object.fromEntries(Object.entries(lists).map(([key, entries]) => [key, entries.length]))).toEqual({
      roster: 1,
      bench: 1,
      tentative: 1,
      absent: 1,
      unassigned: 0,
    })
    expect(pages[0].map((field) => field.name)).toEqual([
      'Provisional roster (1)',
      'Bench (1)',
      'Tentative (1)',
      'Absent (1)',
    ])
    for (const entry of data.signups) {
      expect(JSON.stringify(pages)).toContain(entry.name)
      expect(JSON.stringify(pages)).toContain(entry.player)
    }
    expect(JSON.stringify(pages)).not.toContain('memberId')
  })

  it('uses the actual published team even when signup order would bench them', () => {
    const data = raid({
      published: true,
      roster: [player('two'), player('nosignup')],
      signups: [player('one'), player('two'), player('three', 'tentative'), player('four', 'absent')],
    })
    const lists = rosterLists(data)
    expect(lists.roster.map((entry) => entry.memberId)).toEqual(['two', 'nosignup'])
    expect(lists.bench.map((entry) => entry.memberId)).toEqual(['one'])
    expect(lists.tentative.map((entry) => entry.memberId)).toEqual(['three'])
    expect(lists.absent.map((entry) => entry.memberId)).toEqual(['four'])
  })

  it('keeps empty categories visible and labels unassigned roles without pretending they fill a slot', () => {
    expect(rosterPages(raid()).pages[0].map((field) => field.value)).toEqual(['None', 'None', 'None', 'None'])
    const data = raid({ signups: [player('unknown', 'signed', null)] })
    expect(rosterPages(data).pages[0].at(-1).name).toBe('Role needed (1)')
    expect(playerName({ player: 'Nova' })).toBe('Nova')
  })

  it('preserves every full name across public continuation messages and private pages at the 200-player cap', () => {
    const signups = Array.from({ length: 200 }, (_, i) => ({
      ...player(String(i).padStart(3, '0'), 'late'),
      name: `${String(i).padStart(3, '0')}${'*'.repeat(27)}`,
      player: `${String(i).padStart(3, '0')}${'_'.repeat(27)}`,
      spec: '*'.repeat(40),
    }))
    const data = raid({ signups })
    const messages = signupMessages(data)
    expect(messages.length).toBeLessThanOrEqual(20)
    const publicFields = messages
      .flatMap((message) => message.embeds[0].fields)
      .map((field) => field.value)
      .join('\n')
    const { pages } = rosterPages(data)
    expect(pages.length).toBeLessThanOrEqual(20)
    const privateFields = pages.flatMap((fields) => fields.map((field) => field.value)).join('\n')
    for (const entry of signups)
      for (const text of [publicFields, privateFields]) {
        expect(text).toContain(escapeDiscord(entry.name))
        expect(text).toContain(escapeDiscord(entry.player))
      }
    for (const message of messages) expect(size(message.embeds[0])).toBeLessThanOrEqual(6000)
    for (let page = 1; page <= pages.length; page++) {
      const reply = raidCommandReply({ name: 'roster', page }, overview([data]), 'https://example.com/')
      expect(size(reply.embeds[0])).toBeLessThanOrEqual(6000)
      for (const field of reply.embeds[0].fields) expect(field.value.length).toBeLessThanOrEqual(1024)
    }
  })

  it('selects another raid by its upcoming number and validates raid/page options', () => {
    const reply = raidCommandReply(
      { name: 'roster', raid: 2 },
      overview([raid(), raid({ raidName: 'Second raid', signups: [player('second')] })]),
      'https://example.com/',
    )
    expect(reply.embeds[0].title).toBe('#2 · Second raid')
    expect(JSON.stringify(reply)).toContain('Player second')
    expect(
      raidCommandReply({ name: 'roster', raid: 3 }, overview([raid()]), 'https://example.com/').content,
    ).toMatch(/raid number/)
    const command = (options) => ({
      type: 2,
      id: '100000000000000001',
      guild_id: '100000000000000002',
      channel_id: '100000000000000003',
      member: { user: { id: '100000000000000004' } },
      data: { type: 1, name: 'raid', options: [{ type: 1, name: 'roster', options }] },
    })
    expect(
      parseRaidCommand(
        command([
          { name: 'raid', type: 4, value: 2 },
          { name: 'page', type: 4, value: 3 },
        ]),
      ),
    ).toMatchObject({ name: 'roster', raid: 2, page: 3 })
    expect(parseRaidCommand(command([{ name: 'raid', type: 4, value: 51 }]))).toBeNull()
    expect(
      parseRaidCommand(
        command([
          { name: 'raid', type: 4, value: 2 },
          { name: 'raid', type: 4, value: 3 },
        ]),
      ),
    ).toBeNull()
  })

  it('keeps signup controls on the final continuation and removes surplus messages when lists shrink', async () => {
    const messages = signupMessages(
      raid({ signups: Array.from({ length: 150 }, (_, i) => player(`Raider-${i}-${'x'.repeat(10)}`)) }),
    )
    expect(messages.length).toBeGreaterThan(1)
    const requests = [],
      saved = []
    let nextId = 100000000000000001n
    const fetchFn = async (url, init) => {
      requests.push({ url, ...init })
      return new Response(JSON.stringify({ id: String(nextId++) }), { status: 200 })
    }
    const target = { type: 'bot', channelId: '200000000000000001', token: 'test-token' }
    const controls = [{ type: 1, components: [{ type: 2, style: 1, label: 'Sign up', custom_id: 'signup' }] }]
    const ids = await deliverMessages(target, messages, [], {
      fetchFn,
      components: controls,
      checkpoint: async (values) => saved.push(values),
    })
    expect(JSON.parse(requests.at(-1).body).components).toEqual(controls)
    expect(requests.slice(0, -1).every((request) => JSON.parse(request.body).components.length === 0)).toBe(
      true,
    )
    requests.length = 0
    await deliverMessages(target, signupMessages(raid()), ids, {
      fetchFn,
      components: controls,
      checkpoint: async (values) => saved.push(values),
    })
    expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(ids.length - 1)
    expect(saved.at(-1)).toHaveLength(1)
  })
})
