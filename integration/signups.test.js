import { beforeAll, describe, expect, test } from 'vitest'
import { localSupabase } from '../dev/local-supabase.js'
import { createGuildWithRows } from '../src/lib/remote/api.js'
import { stateToRows } from '../src/lib/remote/rows.js'
import { getSignupPost, listRaidSignups, queueSignupPost } from '../src/lib/raid-services.js'
import { createSeedState } from '../src/lib/seed.js'
import { mondayOf, todayIso } from '../src/lib/time.js'
import { discordId, signedInPlayer } from './setup.js'

/** Sign-up posts through the real API: who may queue and read them, and who may record a press. */
const THIS_WEEK = mondayOf(todayIso('UTC'))

function draftGuild(officerDiscordId) {
  const seed = createSeedState()
  const start = Date.now() + 24 * 3600_000
  return {
    ...seed,
    currentWeek: THIS_WEEK,
    weeks: {
      [THIS_WEEK]: {
        checkins: {},
        plans: { 'raid-20': { start, team: [], locked: [], attendance: {}, cancelled: false } },
      },
    },
    members: seed.members.map((m, i) =>
      i === 0 ? { ...m, discordId: officerDiscordId, officer: true } : { ...m, officer: false },
    ),
  }
}

describe('Discord sign-up posts against a local Supabase', () => {
  let officer
  let guildId

  beforeAll(async () => {
    const officerDiscord = discordId()
    officer = await signedInPlayer(officerDiscord)
    const state = draftGuild(officerDiscord)
    const me = state.members[0]
    guildId = await createGuildWithRows(
      officer,
      {
        name: state.guild.name,
        timezone: state.guild.timezone,
        dayStartHour: state.guild.dayStartHour,
        slotsPerDay: state.guild.slotsPerDay,
        settings: state.settings,
      },
      { id: me.id, name: me.name, position: 0 },
      stateToRows(state, '00000000-0000-0000-0000-000000000000'),
    )
  })

  test('a sign-up post needs the bot channel, then officers can queue it', async () => {
    await expect(queueSignupPost(officer, guildId, THIS_WEEK, 'raid-20')).rejects.toThrow(/WhenToRaid bot/)
    const { error } = await officer.rpc('set_guild_discord', {
      p_guild_id: guildId,
      p_webhook_url: '',
      p_mention_players: false,
      p_channel_id: '733333333333333339',
    })
    expect(error).toBeNull()
    expect(await queueSignupPost(officer, guildId, THIS_WEEK, 'raid-20')).toMatch(/^[0-9a-f-]{36}$/)
    expect(await getSignupPost(officer, guildId, THIS_WEEK, 'raid-20')).toEqual([
      expect.objectContaining({ status: 'pending', posted: false }),
    ])
  })

  test('guild members read the week’s sign-ups; outsiders cannot', async () => {
    expect(await listRaidSignups(officer, guildId, THIS_WEEK)).toEqual([])
    const outsider = await signedInPlayer(discordId())
    await expect(listRaidSignups(outsider, guildId, THIS_WEEK)).rejects.toThrow(/not a guild member/)
    await expect(queueSignupPost(outsider, guildId, THIS_WEEK, 'raid-20')).rejects.toThrow()
  })

  test('only the server records Discord sign-ups', async () => {
    const press = {
      p_interaction_id: '766666666666666699',
      p_discord_id: '641111111111111199',
      p_discord_guild_id: '744444444444444499',
      p_channel_id: '733333333333333339',
      p_message_id: '755555555555555599',
      p_delivery_id: '00000000-0000-4000-8000-000000000099',
      p_status: 'signed',
      p_character_id: null,
    }
    const signedIn = await officer.rpc('signup_from_discord', press)
    expect(signedIn.error?.message).toMatch(/permission denied/)
    const server = await localSupabase().admin.rpc('signup_from_discord', press)
    expect(server.error).toBeNull()
    expect(server.data).toEqual({ outcome: 'unknown' })
  })
})
