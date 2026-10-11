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

export { TABLES }
