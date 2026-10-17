/** Player responses to a published roster. These never touch the guild-wide revision. */
async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

export const RESPONSE_STATUSES = ['confirmed', 'tentative', 'unavailable']
export const MAX_RESPONSE_NOTE = 500

/**
 * A player's assignment in a published roster, as the server records it: a response stays current
 * while this is unchanged, so republishing to swap someone else keeps everyone's answers, while a
 * new time, character or role asks the player again. Null when they are not rostered.
 */
export function assignmentKey(published, memberId) {
  const entry = published?.team.find((e) => e.memberId === memberId)
  return entry ? `${entry.characterId}|${entry.role}|${published.start}|${published.end}` : null
}

export const listRaidResponses = (client, guildId, week, raidId) =>
  rpc(client, 'get_raid_responses', { p_guild_id: guildId, p_week: week, p_raid_id: raidId })

export const saveRaidResponse = (client, guildId, week, raidId, publication, status, note = '') =>
  rpc(client, 'save_raid_response', {
    p_guild_id: guildId,
    p_week: week,
    p_raid_id: raidId,
    p_publication: String(publication),
    p_status: status,
    p_note: note,
  })

const LOCAL_KEY = 'whentoraid-raid-responses-v1'
function readLocal(storage) {
  try {
    return JSON.parse(storage.getItem(LOCAL_KEY) ?? '{}')
  } catch {
    return {}
  }
}
function localKey(guild, week, raidId) {
  return JSON.stringify([guild, week, raidId])
}

export function localRaidResponses(guild, week, raidId, storage = localStorage) {
  return Object.values(readLocal(storage)[localKey(guild, week, raidId)] ?? {})
}

export function saveLocalRaidResponse(
  guild,
  week,
  raidId,
  memberId,
  published,
  status,
  note = '',
  storage = localStorage,
) {
  const assignment = assignmentKey(published, memberId)
  if (!assignment) throw new Error('Only rostered players can respond.')
  if (!RESPONSE_STATUSES.includes(status)) throw new Error('Choose a valid raid response.')
  if (note.length > MAX_RESPONSE_NOTE) throw new Error(`Keep the note to ${MAX_RESPONSE_NOTE} characters.`)
  const all = readLocal(storage)
  const key = localKey(guild, week, raidId)
  all[key] = {
    ...all[key],
    [memberId]: {
      member_id: memberId,
      publication: String(published.publishedAt),
      assignment,
      status,
      note: note.trim(),
      updated_at: new Date().toISOString(),
    },
  }
  storage.setItem(LOCAL_KEY, JSON.stringify(all))
}

/** Current responses keyed by member, ignoring any given to a different assignment. */
export function responsesByMember(rows, published) {
  return Object.fromEntries(
    (rows ?? [])
      .filter((row) => row.assignment === assignmentKey(published, row.member_id))
      .map((row) => [row.member_id, row]),
  )
}

/** Every rostered player is confirmed, tentative, unavailable or still waiting. */
export function responseSummary(team, byMember) {
  const summary = { confirmed: [], tentative: [], unavailable: [], waiting: [] }
  for (const entry of team) {
    const status = byMember[entry.memberId]?.status
    summary[RESPONSE_STATUSES.includes(status) ? status : 'waiting'].push(entry)
  }
  return summary
}

// Online guilds only: Discord delivery, reminders and calendar feeds run on the server.

export const getReminderSettings = (client, guildId) =>
  rpc(client, 'get_raid_reminders', { p_guild_id: guildId })

export const setReminderSettings = (client, guildId, settings) =>
  rpc(client, 'set_raid_reminders', { p_guild_id: guildId, p_settings: settings })

export const queueDiscordDelivery = (client, guildId, week, raidId, action = 'post') =>
  rpc(client, 'queue_discord_delivery', {
    p_guild_id: guildId,
    p_week: week,
    p_raid_id: raidId,
    p_action: action,
  })

export const listDiscordDeliveries = (client, guildId, week, raidId) =>
  rpc(client, 'get_discord_deliveries', { p_guild_id: guildId, p_week: week, p_raid_id: raidId })

export const retryDiscordDelivery = (client, guildId, deliveryId) =>
  rpc(client, 'retry_discord_delivery', { p_guild_id: guildId, p_id: deliveryId })

/** Ask the worker to send now. If it is unavailable, queued messages wait for the next run. */
export async function dispatchDiscordDeliveries(client, guildId) {
  const { data, error } = await client.functions.invoke('raid-dispatch', { body: { guildId } })
  if (error)
    throw new Error('The message is queued but could not be sent yet. Try again shortly.', { cause: error })
  return data?.results ?? []
}

/** A week's Discord sign-ups for every raid, in sign-up order. Any guild member may read them. */
export const listRaidSignups = (client, guildId, week) =>
  rpc(client, 'get_raid_signups', { p_guild_id: guildId, p_week: week })

/** Officers: post a raid's sign-up to Discord now (or refresh it); the worker sends it. */
export const queueSignupPost = (client, guildId, week, raidId) =>
  rpc(client, 'queue_signup_post', { p_guild_id: guildId, p_week: week, p_raid_id: raidId })

/** Officers: whether a raid's sign-up post is in Discord, queued, or failed. */
export const getSignupPost = (client, guildId, week, raidId) =>
  rpc(client, 'get_signup_post', { p_guild_id: guildId, p_week: week, p_raid_id: raidId })

export const createCalendarSubscription = (client, guildId) =>
  rpc(client, 'create_raid_calendar', { p_guild_id: guildId })

export const revokeCalendarSubscription = (client, guildId) =>
  rpc(client, 'revoke_raid_calendar', { p_guild_id: guildId })

export const calendarSubscriptionUrl = (baseUrl, token) =>
  `${baseUrl.replace(/\/$/, '')}/functions/v1/raid-calendar?token=${encodeURIComponent(token)}`
