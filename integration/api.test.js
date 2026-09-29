import { beforeAll, describe, expect, test } from 'vitest'
import { applyOps, createGuild, fetchGuild, listGuilds, myDiscordId } from '../src/lib/remote/api.js'
import { diffRows, rowsToState, stateToRows } from '../src/lib/remote/rows.js'
import { markUnavailable, setSlotAvailable } from '../src/lib/model.js'
import { createSeedState, SEED_WEEK } from '../src/lib/seed.js'
import { addDays, daysBetween, mondayOf, todayIso } from '../src/lib/time.js'
import { discordId, signedInPlayer } from './setup.js'

const THIS_WEEK = mondayOf(todayIso('UTC'))
const SINCE = addDays(THIS_WEEK, -7 * 12)

/**
 * The seed guild moved to the current week (the database only takes check-ins within a year of
 * today), with the officer linked to their Discord ID.
 */
function officerGuild(officerDiscordId) {
  const shift = daysBetween(SEED_WEEK, THIS_WEEK)
  const moved = createSeedState()
  const seed = {
    ...moved,
    currentWeek: THIS_WEEK,
    weeks: Object.fromEntries(
      Object.entries(moved.weeks).map(([week, data]) => [addDays(week, shift), data]),
    ),
  }
  return {
    ...seed,
    members: seed.members.map((m, i) =>
      i === 0 ? { ...m, discordId: officerDiscordId, officer: true } : { ...m, officer: false },
    ),
  }
}

describe('online guilds against a local Supabase', () => {
  const officerDiscord = discordId()
  const playerDiscord = discordId()
  let officer
  let player
  let guildId
  let state

  beforeAll(async () => {
    officer = await signedInPlayer(officerDiscord)
    player = await signedInPlayer(playerDiscord)
  })

  test('the database knows each player’s Discord ID', async () => {
    expect(await myDiscordId(officer)).toBe(officerDiscord)
  })

  test('an officer creates a guild and uploads the whole roster', async () => {
    state = officerGuild(officerDiscord)
    const me = state.members[0]
    guildId = await createGuild(
      officer,
      {
        name: state.guild.name,
        timezone: state.guild.timezone,
        dayStartHour: state.guild.dayStartHour,
        slotsPerDay: state.guild.slotsPerDay,
        settings: state.settings,
      },
      { id: me.id, name: me.name, position: 0 },
    )
    const created = await fetchGuild(officer, guildId, SINCE)
    await applyOps(officer, diffRows(created, stateToRows(state, guildId)))

    const loaded = rowsToState(await fetchGuild(officer, guildId, SINCE), {
      currentWeek: state.currentWeek,
      currentMemberId: state.currentMemberId,
    })
    expect(loaded).toEqual(state)
  })

  test('adding a player’s Discord ID lets them in', async () => {
    expect(await listGuilds(player)).toEqual([])
    const invited = {
      ...state,
      members: state.members.map((m, i) => (i === 1 ? { ...m, discordId: playerDiscord } : m)),
    }
    await applyOps(officer, diffRows(stateToRows(state, guildId), stateToRows(invited, guildId)))
    state = invited
    expect((await listGuilds(player)).map((g) => g.id)).toEqual([guildId])
  })

  test('a player saves their own check-in but not someone else’s', async () => {
    const mine = state.members[1].id
    const theirs = state.members[2].id
    const shadow = stateToRows(state, guildId)

    const checkedIn = setSlotAvailable(state, THIS_WEEK, mine, { start: 1e12, end: 1e12 + 1800000 }, true)
    await applyOps(player, diffRows(shadow, stateToRows(checkedIn, guildId)))
    const reloaded = rowsToState(await fetchGuild(player, guildId, SINCE), state)
    expect(reloaded.weeks[THIS_WEEK].checkins[mine]).toEqual(checkedIn.weeks[THIS_WEEK].checkins[mine])

    const meddling = markUnavailable(state, THIS_WEEK, theirs)
    await expect(applyOps(player, diffRows(shadow, stateToRows(meddling, guildId)))).rejects.toThrow(
      /permission/,
    )
  })

  test('a player cannot rename the guild', async () => {
    const renamed = { ...state, guild: { ...state.guild, name: 'Hijacked' } }
    await expect(
      applyOps(player, diffRows(stateToRows(state, guildId), stateToRows(renamed, guildId))),
    ).rejects.toThrow(/permission/)
  })
})
