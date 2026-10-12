import { beforeAll, describe, expect, test } from 'vitest'
import { localSupabase } from '../dev/local-supabase.js'
import { createGuildWithRows } from '../src/lib/remote/api.js'
import { stateToRows } from '../src/lib/remote/rows.js'
import {
  calendarSubscriptionUrl,
  createCalendarSubscription,
  dispatchDiscordDeliveries,
  revokeCalendarSubscription,
} from '../src/lib/raid-services.js'
import { createSeedState, SEED_WEEK } from '../src/lib/seed.js'
import { addDays, daysBetween, mondayOf, todayIso } from '../src/lib/time.js'
import { discordId, signedInPlayer } from './setup.js'

/**
 * The Edge Functions, served by `npx supabase functions serve`. Skipped when they are not running,
 * so the rest of the integration suite still runs against just the database.
 */
const THIS_WEEK = mondayOf(todayIso('UTC'))
const functionsUp = await fetch(`${localSupabase().apiUrl}/functions/v1/raid-calendar?token=x`)
  .then((response) => response.status === 404)
  .catch(() => false)

/** The seed guild moved to this week, with the officer linked and a roster published for tomorrow. */
function publishedGuild(officerDiscordId) {
  const seed = createSeedState()
  const shift = daysBetween(SEED_WEEK, THIS_WEEK)
  const start = Date.now() + 24 * 3600_000
  const team = [{ memberId: 'm0', characterId: 'c0a', role: 'Tank' }]
  const weeks = Object.fromEntries(
    Object.entries(seed.weeks).map(([week, data]) => [addDays(week, shift), data]),
  )
  weeks[THIS_WEEK] = {
    checkins: {},
    ...weeks[THIS_WEEK],
    plans: {
      'raid-20': {
        start,
        team,
        locked: [],
        published: {
          start,
          end: start + 3 * 3600_000,
          publishedAt: Date.now(),
          day: 0,
          startSlot: 2,
          raidName: '20-player Raid',
          team,
          targets: [2, 4, 14],
        },
      },
    },
  }
  return {
    ...seed,
    currentWeek: THIS_WEEK,
    weeks,
    members: seed.members.map((m, i) =>
      i === 0 ? { ...m, discordId: officerDiscordId, officer: true } : { ...m, officer: false },
    ),
  }
}

describe.skipIf(!functionsUp)('raid Edge Functions against a local Supabase', () => {
  let officer
  let guildId

  beforeAll(async () => {
    const officerDiscord = discordId()
    officer = await signedInPlayer(officerDiscord)
    const state = publishedGuild(officerDiscord)
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

  test('a player’s calendar feed lists their published raid until they revoke it', async () => {
    const token = await createCalendarSubscription(officer, guildId)
    const url = calendarSubscriptionUrl(localSupabase().apiUrl, token)

    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/text\/calendar/)
    const body = await response.text()
    expect(body).toContain('STATUS:CONFIRMED')
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1)

    await revokeCalendarSubscription(officer, guildId)
    expect((await fetch(url)).status).toBe(404)
  })

  test('an officer runs the dispatcher for their guild; nothing is queued without a channel', async () => {
    expect(await dispatchDiscordDeliveries(officer, guildId)).toEqual([])
  })

  test('someone who is not an officer of the guild cannot run the dispatcher', async () => {
    const outsider = await signedInPlayer(discordId())
    await expect(dispatchDiscordDeliveries(outsider, guildId)).rejects.toThrow()
  })
})
