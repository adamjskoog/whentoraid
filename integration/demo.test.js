import { expect, test } from 'vitest'
import { createGuildWithRows, fetchGuild } from '../src/lib/remote/api.js'
import { newGuildPayload } from '../src/lib/remote/rows.js'
import { createDemoState } from '../src/lib/seed.js'
import { discordId, signedInPlayer } from './setup.js'

test('a signed-in officer creates the demo guild online, with its sample year', async () => {
  const me = discordId()
  const officer = await signedInPlayer(me)
  const demo = createDemoState()
  const { guild, me: member, rows } = newGuildPayload(demo, me)
  const guildId = await createGuildWithRows(officer, { ...guild, name: `${guild.name} (demo)` }, member, rows)

  const loaded = await fetchGuild(officer, guildId, '0001-01-01')
  expect(loaded.guilds[0].name).toBe(`${demo.guild.name} (demo)`)
  expect(loaded.guilds[0].settings.demoYear).toBe(demo.demoYear)
  expect(loaded.members).toHaveLength(demo.members.length)
  expect(loaded.members.find((m) => m.discord_id === me)).toMatchObject({ is_officer: true })
  expect(loaded.plans.length).toBeGreaterThan(0)
})
