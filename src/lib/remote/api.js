import { KEY_COLUMNS, TABLES } from './rows.js'

/**
 * Database calls for online guilds. Each takes a Supabase client, so the same code runs in the
 * browser and in integration tests against a local Supabase. Row-level security controls reads;
 * the revision RPC in supabase/migrations authorizes writes.
 */

/** Postgres error codes that deserve a plain-language message. */
const FRIENDLY_ERRORS = {
  42501: 'You don’t have permission to make that change. Ask a guild officer.',
  23505: 'That Discord ID already belongs to another player in this guild.',
  40001: 'This guild changed in another window. Your edit was not saved; review the latest version.',
  PGRST116: 'That guild could not be found, or you are not a member.',
}

/** An Error with a message fit for a toast; `code` keeps the database's code. */
export function friendlyError(error) {
  const message = FRIENDLY_ERRORS[error?.code] ?? error?.message ?? 'Something went wrong.'
  return Object.assign(new Error(message), { code: error?.code })
}

function check({ data, error }) {
  if (error) throw friendlyError(error)
  return data
}

/** Guilds the signed-in player belongs to, by name. @returns {Promise<{ id: string, name: string }[]>} */
export async function listGuilds(client) {
  return check(await client.from('guilds').select('id, name').order('name'))
}

/** The caller's Discord user ID as the database sees it, or null. */
export async function myDiscordId(client) {
  return check(await client.rpc('my_discord_id'))
}

/** The API returns at most this many rows per request (`max_rows` in supabase/config.toml). */
const PAGE_ROWS = 1000

/** Every row a query matches, a page at a time, in primary-key order so pages do not overlap. */
async function fetchAll(makeQuery, table) {
  const rows = []
  for (let from = 0; ; from += PAGE_ROWS) {
    const query = KEY_COLUMNS[table].reduce((q, column) => q.order(column), makeQuery())
    const page = check(await query.range(from, from + PAGE_ROWS - 1))
    rows.push(...page)
    if (page.length < PAGE_ROWS) return rows
  }
}

/**
 * Every row of one guild. Check-ins are limited to weeks from `sinceWeek` on, since older weeks
 * only matter for their plans (attendance history).
 * @returns {Promise<import('./rows.js').Rows>}
 */
export async function fetchGuild(client, guildId, sinceWeek) {
  const byGuild = (table) => fetchAll(() => client.from(table).select('*').eq('guild_id', guildId), table)
  const readRevision = async () =>
    check(await client.from('guild_revisions').select('revision').eq('guild_id', guildId).single())
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await readRevision()
    const guilds = check(await client.from('guilds').select('*').eq('id', guildId))
    if (!guilds.length) throw friendlyError({ code: 'PGRST116' })
    const fromWeek = guilds[0].settings.demoYear ? '0001-01-01' : sinceWeek
    const [members, characters, checkins, plans, templates] = await Promise.all([
      byGuild('members'),
      byGuild('characters'),
      fetchAll(
        () => client.from('checkins').select('*').eq('guild_id', guildId).gte('week', fromWeek),
        'checkins',
      ),
      byGuild('plans'),
      byGuild('availability_templates'),
    ])
    const after = await readRevision()
    if (before.revision !== after.revision) continue
    return {
      guilds,
      members,
      characters,
      checkins,
      plans,
      availability_templates: templates,
      revision: after.revision,
    }
  }
  throw friendlyError({ code: '40001' })
}

/**
 * Create a guild with the caller as its first officer.
 * @param {{ name: string, timezone: string, dayStartHour: number, slotsPerDay: number, settings: object }} guild
 * @param {{ id: string, name: string, position: number }} me
 * @returns {Promise<string>} the new guild's id
 */
export async function createGuild(client, guild, me) {
  return check(await client.rpc('create_guild', { guild, member: me }))
}

/** Create and upload a complete online guild in one database transaction. */
export async function createGuildWithRows(client, guild, me, rows) {
  return check(await client.rpc('create_online_guild', { p_guild: guild, p_member: me, p_rows: rows }))
}

/** Apply one complete save transaction and return its new revision. */
export async function applyOps(client, guildId, revision, ops) {
  if (!ops.length) return revision
  return check(
    await client.rpc('apply_guild_changes', {
      p_guild_id: guildId,
      p_revision: revision,
      p_ops: ops,
    }),
  )
}

/**
 * The guild's Discord channel, readable by officers only. `channelId` is set when the WhenToRaid bot
 * posts rosters (with response buttons) instead of a webhook.
 * @returns {Promise<{ webhookUrl: string, channelId: string, mentionPlayers: boolean, posts: Record<string, string[]> } | null>}
 */
export async function getGuildDiscord(client, guildId) {
  const [row] = check(await client.rpc('get_guild_discord', { p_guild_id: guildId }))
  return row
    ? {
        webhookUrl: row.webhook_url ?? '',
        channelId: row.channel_id ?? '',
        mentionPlayers: row.mention_players,
        posts: row.posts,
      }
    : null
}

/** Set the guild's Discord channel; an empty URL and channel ID remove it. */
export async function setGuildDiscord(client, guildId, { webhookUrl, mentionPlayers, channelId = '' }) {
  check(
    await client.rpc('set_guild_discord', {
      p_guild_id: guildId,
      p_webhook_url: webhookUrl,
      p_mention_players: mentionPlayers,
      p_channel_id: channelId,
    }),
  )
}

/** Remember the Discord messages holding one raid's roster (`key` is "week/raid id"). */
export async function recordDiscordPost(client, guildId, key, messageIds) {
  check(
    await client.rpc('record_discord_post', { p_guild_id: guildId, p_key: key, p_message_ids: messageIds }),
  )
}

/** The guild's invite code, or null when its invite link is off. Officers only. */
export async function currentInvite(client, guildId) {
  return check(await client.rpc('current_guild_invite', { p_guild_id: guildId }))
}

/** Turn the invite link on (or keep it), or with `reset` replace it so old links stop working. */
export async function createInvite(client, guildId, { reset = false } = {}) {
  return check(await client.rpc('guild_invite_code', { p_guild_id: guildId, p_reset: reset }))
}

export async function disableInvite(client, guildId) {
  check(await client.rpc('disable_guild_invite', { p_guild_id: guildId }))
}

/** A seven-day single-use link for one unclaimed non-officer; replaces their previous link. */
export async function createMemberInvite(client, guildId, memberId) {
  return check(await client.rpc('create_member_invite', { p_guild_id: guildId, p_member_id: memberId }))
}

export async function disableMemberInvite(client, guildId, memberId) {
  check(await client.rpc('disable_member_invite', { p_guild_id: guildId, p_member_id: memberId }))
}

/**
 * What an invite offers: no existing profiles for a general link, exactly one for a personal link.
 * @returns {Promise<{ guildId: string, guildName: string, alreadyMember: boolean, openPlayers: { id: string, name: string }[] }>}
 */
export async function inviteDetails(client, code) {
  const [row] = check(await client.rpc('invite_details', { p_code: code }))
  return {
    guildId: row.guild_id,
    guildName: row.guild_name,
    alreadyMember: row.already_member,
    openPlayers: row.open_players,
  }
}

/**
 * Join through an invite as the listed player `memberId`, or as a new player named `name`.
 * @returns {Promise<string>} the guild's id
 */
export async function joinGuild(client, code, { memberId = null, name = '' }) {
  return check(await client.rpc('join_guild', { p_code: code, p_member_id: memberId, p_name: name }))
}

export { TABLES }
