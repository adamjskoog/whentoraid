import { describe, expect, it } from 'vitest'
import { rosterMessages } from '../../supabase/functions/_shared/roster-post.js'

const START = 1792000800000
const ID = (n) => `1${String(n).padStart(17, '0')}`
const roster = (overrides = {}) => ({
  guildName: 'Raid Test Client',
  raidName: '10-player Raid 1',
  start: START,
  targets: [1, 2, 7],
  cancelled: false,
  withdrawn: false,
  team: [
    { name: 'Skoogerino', player: 'Skooger', class: 'Rogue', spec: 'Combat', role: 'DPS', discordId: ID(1) },
    {
      name: 'Tankus',
      player: 'Tankus',
      class: 'Warrior',
      spec: 'Protection',
      role: 'Tank',
      discordId: ID(2),
    },
  ],
  ...overrides,
})

describe('roster card', () => {
  it('looks like the signup card: guild, raid, time, role counts and class-marked role columns', () => {
    const [message] = rosterMessages(roster())
    const [embed] = message.embeds
    expect(embed.author.name).toBe('Raid Test Client')
    expect(embed.title).toBe('10-player Raid 1')
    expect(embed.timestamp).toBe(new Date(START).toISOString())
    expect(embed.description).toContain(`<t:${START / 1000}:F>`)
    expect(embed.description).toContain(
      '🛡️ Tanks **1**/1 · 💚 Healers **0**/2 · ⚔️ DPS **1**/7 · **2** rostered',
    )
    expect(embed.description).toContain('**Still needed:** 2 healers, 6 DPS')
    const fields = Object.fromEntries(embed.fields.map((field) => [field.name, field.value]))
    expect(fields['🛡️ Tanks (1/1)']).toBe('`1` 🟫 **Tankus** Protection')
    expect(fields['💚 Healers (0/2)']).toBe('None')
    expect(fields['⚔️ DPS (1/7)']).toBe('`2` 🟨 **Skoogerino** (Skooger) Combat')
  })

  it('pings raiders in the message text, since Discord never pings from an embed', () => {
    const [message] = rosterMessages(roster(), [ID(1), ID(2), 'not-an-id'])
    expect(message.content).toBe(`**Raiders:** <@${ID(1)}> <@${ID(2)}>`)
    expect(rosterMessages(roster())[0].content).toBe('')
  })

  it('keeps the ping line inside Discord’s message limit', () => {
    const ids = Array.from({ length: 100 }, (_, i) => ID(i + 1))
    const [message] = rosterMessages(roster(), ids)
    expect(message.content.length).toBeLessThanOrEqual(2000)
  })

  it('says when every role target is filled', () => {
    const [message] = rosterMessages(roster({ targets: [1, 0, 1] }))
    expect(message.embeds[0].description).toContain('All role targets filled.')
  })

  it('shows a withdrawn or cancelled roster without names or pings', () => {
    for (const [overrides, text] of [
      [{ withdrawn: true }, 'This roster has been withdrawn. Await a new published roster.'],
      [{ cancelled: true }, 'This raid has been cancelled.'],
    ]) {
      const messages = rosterMessages(roster(overrides), [ID(1)])
      expect(messages).toHaveLength(1)
      expect(messages[0].content).toBe('')
      expect(messages[0].embeds[0].description).toContain(text)
      expect(messages[0].embeds[0].fields ?? []).toHaveLength(0)
    }
  })

  it('escapes user-controlled names and never drops players from long rosters', () => {
    const team = Array.from({ length: 40 }, (_, i) => ({
      name: `[Free nitro](https://evil.example) ${'N'.repeat(60)}${i}`,
      role: 'DPS',
    }))
    const messages = rosterMessages(roster({ guildName: '@everyone', raidName: '@here', team }))
    const text = JSON.stringify(messages)
    expect(text).not.toContain('](')
    expect(messages[0].embeds[0].title).not.toBe('@here')
    for (let i = 0; i < 40; i++) expect(text).toContain(`N${i}`)
  })

  it('still renders payloads queued before targets, classes and specs were added', () => {
    const [message] = rosterMessages({
      guildName: 'Guild',
      raidName: 'Raid',
      start: START,
      team: [{ name: 'Old', role: 'DPS' }],
    })
    expect(message.embeds[0].fields.find((field) => field.name.startsWith('⚔️')).value).toBe('`1` ▫️ **Old**')
  })
})
