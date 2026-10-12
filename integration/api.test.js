import { beforeAll, describe, expect, test } from 'vitest'
import {
  applyOps,
  createGuildWithRows,
  createInvite,
  currentInvite,
  disableInvite,
  fetchGuild,
  getGuildDiscord,
  inviteDetails,
  joinGuild,
  listGuilds,
  myDiscordId,
  recordDiscordPost,
  setGuildDiscord,
} from '../src/lib/remote/api.js'
import { diffRows, rowsToState, stateToRows } from '../src/lib/remote/rows.js'
import {
  markUnavailable,
  retireCharacter,
  saveCharacter,
  setPlan,
  setSlotAvailable,
} from '../src/lib/model.js'
import { createSeedState, SEED_WEEK } from '../src/lib/seed.js'
import { addDays, daysBetween, mondayOf, todayIso } from '../src/lib/time.js'
import { discordId, signedInPlayer } from './setup.js'

const THIS_WEEK = mondayOf(todayIso('UTC'))
const SINCE = addDays(THIS_WEEK, -7 * 12)

async function save(client, guildId, before, after) {
  const { revision } = await fetchGuild(client, guildId, SINCE)
  return applyOps(client, guildId, revision, diffRows(before, after))
}

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

    const loaded = rowsToState(await fetchGuild(officer, guildId, SINCE), {
      currentWeek: state.currentWeek,
      currentMemberId: state.currentMemberId,
    })
    expect(loaded).toEqual(state)
  })

  test('a failed initial upload leaves no partly created guild', async () => {
    const before = await listGuilds(officer)
    const rows = stateToRows(state, '00000000-0000-0000-0000-000000000000')
    rows.characters[0].role = 'Invalid'
    await expect(
      createGuildWithRows(
        officer,
        {
          name: 'Should not exist',
          timezone: state.guild.timezone,
          dayStartHour: state.guild.dayStartHour,
          slotsPerDay: state.guild.slotsPerDay,
          settings: state.settings,
        },
        { id: state.members[0].id, name: state.members[0].name, position: 0 },
        rows,
      ),
    ).rejects.toThrow()
    expect(await listGuilds(officer)).toEqual(before)
  })

  test('direct table writes and revision claims cannot bypass a guild save', async () => {
    const before = await fetchGuild(officer, guildId, SINCE)
    const { error: guildError } = await officer
      .from('guilds')
      .update({ name: 'Bypassed revision' })
      .eq('id', guildId)
    const { error: insertError } = await officer.from('members').insert({
      guild_id: guildId,
      id: 'm-bypass',
      name: 'Bypass',
      discord_id: '',
      is_officer: false,
      position: 99,
    })
    const { error: memberError } = await officer.from('members').delete().eq('guild_id', guildId)
    const { error: revisionError } = await officer.rpc('claim_guild_revision', {
      p_guild_id: guildId,
      p_revision: before.revision,
    })
    expect(guildError?.code).toBe('42501')
    expect(insertError?.code).toBe('42501')
    expect(memberError?.code).toBe('42501')
    expect(revisionError).toBeTruthy()
    const after = await fetchGuild(officer, guildId, SINCE)
    expect(after.revision).toBe(before.revision)
    expect(after.guilds[0].name).toBe(before.guilds[0].name)
    expect(after.members).toEqual(before.members)
  })

  test('adding a player’s Discord ID lets them in', async () => {
    expect(await listGuilds(player)).toEqual([])
    const invited = {
      ...state,
      members: state.members.map((m, i) => (i === 1 ? { ...m, discordId: playerDiscord } : m)),
    }
    await save(officer, guildId, stateToRows(state, guildId), stateToRows(invited, guildId))
    state = invited
    expect((await listGuilds(player)).map((g) => g.id)).toEqual([guildId])
  })

  test('a player saves their own check-in but not someone else’s', async () => {
    const mine = state.members[1].id
    const theirs = state.members[2].id
    const shadow = stateToRows(state, guildId)

    // Next week's check-in deadline is always ahead; this week's may already have passed.
    const nextWeek = addDays(THIS_WEEK, 7)
    const checkedIn = setSlotAvailable(state, nextWeek, mine, { start: 1e12, end: 1e12 + 1800000 }, true)
    await save(player, guildId, shadow, stateToRows(checkedIn, guildId))
    const reloaded = rowsToState(await fetchGuild(player, guildId, SINCE), state)
    expect(reloaded.weeks[nextWeek].checkins[mine]).toEqual(checkedIn.weeks[nextWeek].checkins[mine])

    const meddling = markUnavailable(state, nextWeek, theirs)
    await expect(save(player, guildId, shadow, stateToRows(meddling, guildId))).rejects.toThrow(/permission/)
  })

  test('after the deadline only officers change a week’s check-ins', async () => {
    const lastWeek = addDays(THIS_WEEK, -7)
    const mine = state.members[1].id
    const current = rowsToState(await fetchGuild(officer, guildId, SINCE), state)
    const late = markUnavailable(current, lastWeek, mine)
    const before = stateToRows(current, guildId)
    await expect(save(player, guildId, before, stateToRows(late, guildId))).rejects.toThrow(
      /closed at the deadline/,
    )
    await save(officer, guildId, before, stateToRows(late, guildId))
    const reloaded = rowsToState(await fetchGuild(player, guildId, SINCE), state)
    expect(reloaded.weeks[lastWeek].checkins[mine].ranges).toEqual([])
  })

  test('a player deletes their own character even when it is on a roster', async () => {
    // Regression: deleting rewrote rosters (officer-only) and shifted other players' characters.
    const mine = state.members[1].id
    const alt = { name: 'Emberfall', realm: 'Whitemane', class: 'Priest', spec: 'Holy', role: 'Healer' }
    const withAlt = saveCharacter(state, mine, alt, () => 'c-integration-alt').state
    await save(player, guildId, stateToRows(state, guildId), stateToRows(withAlt, guildId))
    const team = [{ memberId: mine, characterId: 'c-integration-alt', role: 'Healer' }]
    const rostered = setPlan(withAlt, THIS_WEEK, { start: 1e12, team, locked: [mine] })
    await save(officer, guildId, stateToRows(withAlt, guildId), stateToRows(rostered, guildId))

    const retired = retireCharacter(rostered, mine, 'c-integration-alt').state
    await save(player, guildId, stateToRows(rostered, guildId), stateToRows(retired, guildId))

    const reloaded = rowsToState(await fetchGuild(player, guildId, SINCE), state)
    expect(reloaded.characters).toEqual(retired.characters)
    expect(reloaded.weeks[THIS_WEEK].plans).toEqual(rostered.weeks[THIS_WEEK].plans)
    state = retired
  })

  test('a player cannot rename the guild', async () => {
    const renamed = { ...state, guild: { ...state.guild, name: 'Hijacked' } }
    await expect(
      save(player, guildId, stateToRows(state, guildId), stateToRows(renamed, guildId)),
    ).rejects.toThrow(/permission/)
  })

  test('a forbidden delete is reported and does not advance the revision', async () => {
    const before = await fetchGuild(player, guildId, SINCE)
    const other = before.characters.find((character) => character.member_id !== state.members[1].id)
    await expect(
      applyOps(player, guildId, before.revision, [
        {
          table: 'characters',
          kind: 'delete',
          keys: [{ guild_id: guildId, id: other.id }],
        },
      ]),
    ).rejects.toThrow(/permission/)
    const after = await fetchGuild(player, guildId, SINCE)
    expect(after.revision).toBe(before.revision)
    expect(after.characters.some((character) => character.id === other.id)).toBe(true)
  })

  test('a stale officer edit is rejected without overwriting the newer plan', async () => {
    const revision = (await fetchGuild(officer, guildId, SINCE)).revision
    const first = { ...state, guild: { ...state.guild, name: 'First edit' } }
    const second = { ...state, guild: { ...state.guild, name: 'Stale edit' } }
    await applyOps(
      officer,
      guildId,
      revision,
      diffRows(stateToRows(state, guildId), stateToRows(first, guildId)),
    )
    await expect(
      applyOps(
        officer,
        guildId,
        revision,
        diffRows(stateToRows(state, guildId), stateToRows(second, guildId)),
      ),
    ).rejects.toThrow(/changed in another window/)
    expect((await fetchGuild(officer, guildId, SINCE)).guilds[0].name).toBe('First edit')
  })

  test('a failed multi-table batch rolls back its earlier rows and revision', async () => {
    const before = await fetchGuild(officer, guildId, SINCE)
    const ops = [
      {
        table: 'members',
        kind: 'upsert',
        rows: [
          {
            guild_id: guildId,
            id: 'm-rollback',
            name: 'Rollback',
            discord_id: '',
            is_officer: false,
            position: 99,
          },
        ],
      },
      {
        table: 'characters',
        kind: 'upsert',
        rows: [
          {
            guild_id: guildId,
            id: 'c-rollback',
            member_id: 'm-rollback',
            name: 'Broken',
            realm: 'Whitemane',
            spec: 'Arms',
            class: 'Warrior',
            role: 'Invalid',
            main: true,
            retired: false,
            position: 99,
          },
        ],
      },
    ]
    await expect(applyOps(officer, guildId, before.revision, ops)).rejects.toThrow()
    const after = await fetchGuild(officer, guildId, SINCE)
    expect(after.members.some((member) => member.id === 'm-rollback')).toBe(false)
    expect(after.revision).toBe(before.revision)
  })

  test('only officers see and change the Discord channel, and posts are remembered', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-0123'
    expect(await getGuildDiscord(officer, guildId)).toBeNull()
    await setGuildDiscord(officer, guildId, { webhookUrl, mentionPlayers: true })
    await recordDiscordPost(officer, guildId, `${THIS_WEEK}/raid-20`, ['1300000000000000001'])
    expect(await getGuildDiscord(officer, guildId)).toEqual({
      webhookUrl,
      mentionPlayers: true,
      posts: { [`${THIS_WEEK}/raid-20`]: ['1300000000000000001'] },
    })
    await expect(getGuildDiscord(player, guildId)).rejects.toMatchObject({ code: '42501' })
    await expect(
      setGuildDiscord(player, guildId, { webhookUrl: '', mentionPlayers: false }),
    ).rejects.toMatchObject({ code: '42501' })
    // Players load the guild without ever receiving the webhook.
    expect(JSON.stringify(await fetchGuild(player, guildId, SINCE))).not.toContain('webhooks')
  })

  test('players join through the invite link: claiming a listed player, or as someone new', async () => {
    const claimer = await signedInPlayer(discordId())
    const newcomer = await signedInPlayer(discordId())
    expect(await currentInvite(officer, guildId)).toBeNull()
    await expect(createInvite(player, guildId)).rejects.toMatchObject({ code: '42501' })
    const code = await createInvite(officer, guildId)

    const offer = await inviteDetails(claimer, code)
    const { guilds } = await fetchGuild(officer, guildId, SINCE)
    expect(offer).toMatchObject({ guildId, guildName: guilds[0].name, alreadyMember: false })
    const listed = state.members[2]
    expect(offer.openPlayers).toContainEqual({ id: listed.id, name: listed.name })
    expect(offer.openPlayers.map((p) => p.id)).not.toContain(state.members[1].id)
    expect((await inviteDetails(player, code)).alreadyMember).toBe(true)

    const { revision: beforeJoins } = await fetchGuild(officer, guildId, SINCE)
    expect(await joinGuild(claimer, code, { memberId: listed.id })).toBe(guildId)
    expect(await joinGuild(newcomer, code, { name: 'Wren' })).toBe(guildId)
    const loaded = rowsToState(await fetchGuild(newcomer, guildId, SINCE), {
      currentWeek: state.currentWeek,
      currentMemberId: '',
    })
    expect(loaded.members.find((m) => m.id === listed.id).discordId).toBeTruthy()
    expect(loaded.members.at(-1)).toMatchObject({ name: 'Wren', officer: false })

    // A save from a window that loaded before the joins is refused, so it cannot undo them.
    const memberRow = stateToRows(state, guildId).members[0]
    await expect(
      applyOps(officer, guildId, beforeJoins, [{ table: 'members', kind: 'upsert', rows: [memberRow] }]),
    ).rejects.toMatchObject({ code: '40001' })
    await disableInvite(officer, guildId)
    await expect(inviteDetails(claimer, code)).rejects.toThrow(/no longer works/)
  })
})
