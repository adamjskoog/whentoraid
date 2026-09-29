import { STATE_VERSION } from '../model.js'

/**
 * The app keeps one immutable AppState. Online, the same data lives in five tables. These pure
 * functions convert between the two and work out which rows changed, so every model function stays
 * as it is and only changed rows are sent. `currentWeek` and `currentMemberId` are per viewer and
 * never stored.
 *
 * @typedef {import('../model.js').AppState} AppState
 * @typedef {{ guilds: object[], members: object[], characters: object[], checkins: object[], plans: object[] }} Rows
 * @typedef {{ table: string, kind: 'upsert' | 'update', rows: object[] } | { table: string, kind: 'delete', keys: object[] }} Op
 */

/** Tables in foreign-key order: parents first. Deletes run in the reverse order. */
export const TABLES = ['guilds', 'members', 'characters', 'checkins', 'plans']

/** Each table's primary key within a guild. */
export const KEY_COLUMNS = {
  guilds: ['id'],
  members: ['guild_id', 'id'],
  characters: ['guild_id', 'id'],
  checkins: ['guild_id', 'week', 'member_id'],
  plans: ['guild_id', 'week'],
}

/** @param {AppState} state @returns {Rows} */
export function stateToRows(state, guildId) {
  const { guild, settings } = state
  const weeks = Object.entries(state.weeks)
  return {
    guilds: [
      {
        id: guildId,
        name: guild.name,
        timezone: guild.timezone,
        day_start_hour: guild.dayStartHour,
        slots_per_day: guild.slotsPerDay,
        settings: {
          targets: settings.targets,
          durationSlots: settings.durationSlots,
          checkinDeadline: settings.checkinDeadline ?? null,
        },
        discord_server_id: guild.discordServerId ?? '',
        officer_role_ids: guild.officerRoleIds ?? '',
      },
    ],
    members: state.members.map((m, position) => ({
      guild_id: guildId,
      id: m.id,
      name: m.name,
      discord_id: m.discordId ?? '',
      is_officer: Boolean(m.officer),
      position,
    })),
    characters: state.characters.map((c, position) => ({
      guild_id: guildId,
      id: c.id,
      member_id: c.memberId,
      name: c.name,
      realm: c.realm,
      spec: c.spec,
      class: c.class,
      role: c.role,
      main: c.main,
      position,
    })),
    checkins: weeks.flatMap(([week, { checkins }]) =>
      Object.entries(checkins).map(([memberId, checkin]) => ({
        guild_id: guildId,
        week,
        member_id: memberId,
        checked_in: checkin.checkedIn,
        ranges: checkin.ranges,
        declined: checkin.declined,
      })),
    ),
    plans: weeks
      .filter(([, week]) => week.plan)
      .map(([week, { plan }]) => ({
        guild_id: guildId,
        week,
        start: plan.start,
        team: plan.team,
        locked: plan.locked ?? [],
        attendance: plan.attendance ?? {},
        cancelled: Boolean(plan.cancelled),
      })),
  }
}

const byPosition = (a, b) => a.position - b.position

/**
 * @param {Rows} rows as read from the database, for one guild
 * @param {{ currentWeek: string, currentMemberId: string }} viewer
 * @returns {AppState}
 */
export function rowsToState(rows, viewer) {
  const [guild] = rows.guilds
  const weeks = {}
  const weekOf = (week) => (weeks[week] ??= { checkins: {}, plan: null })
  for (const row of rows.checkins) {
    weekOf(row.week).checkins[row.member_id] = {
      checkedIn: row.checked_in,
      ranges: row.ranges,
      declined: row.declined,
    }
  }
  for (const row of rows.plans) {
    weekOf(row.week).plan = {
      start: Number(row.start),
      team: row.team,
      locked: row.locked,
      attendance: row.attendance,
      cancelled: row.cancelled,
    }
  }
  const members = [...rows.members].sort(byPosition).map((m) => ({
    id: m.id,
    name: m.name,
    discordId: m.discord_id,
    officer: m.is_officer,
  }))
  const known = members.some((m) => m.id === viewer.currentMemberId)
  return {
    version: STATE_VERSION,
    currentWeek: viewer.currentWeek,
    currentMemberId: known ? viewer.currentMemberId : (members[0]?.id ?? ''),
    guild: {
      name: guild.name,
      timezone: guild.timezone,
      dayStartHour: guild.day_start_hour,
      slotsPerDay: guild.slots_per_day,
      discordServerId: guild.discord_server_id,
      officerRoleIds: guild.officer_role_ids,
    },
    settings: {
      targets: guild.settings.targets,
      durationSlots: guild.settings.durationSlots,
      checkinDeadline: guild.settings.checkinDeadline ?? null,
    },
    members,
    characters: [...rows.characters].sort(byPosition).map((c) => ({
      id: c.id,
      memberId: c.member_id,
      name: c.name,
      realm: c.realm,
      spec: c.spec,
      class: c.class,
      role: c.role,
      main: c.main,
    })),
    weeks,
  }
}

/**
 * JSON with object keys sorted, so rows compare equal however their keys were ordered. Postgres
 * `jsonb` reorders keys (e.g. `{ start, end }` comes back as `{ end, start }`).
 */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function keyOf(table, row) {
  return KEY_COLUMNS[table].map((column) => row[column]).join('|')
}

function pick(row, columns) {
  return Object.fromEntries(columns.map((column) => [column, row[column]]))
}

/**
 * The writes that turn `before` into `after`: changed or new rows, then removed rows (children
 * first). Guild rows are updated, never upserted: guilds are only created through `create_guild`.
 * @param {Rows} before @param {Rows} after @returns {Op[]}
 */
export function diffRows(before, after) {
  const writes = []
  const deletes = []
  for (const table of TABLES) {
    const old = new Map(before[table].map((row) => [keyOf(table, row), stableJson(row)]))
    const changed = after[table].filter((row) => old.get(keyOf(table, row)) !== stableJson(row))
    const kept = new Set(after[table].map((row) => keyOf(table, row)))
    const removed = before[table].filter((row) => !kept.has(keyOf(table, row)))
    if (changed.length) writes.push({ table, kind: table === 'guilds' ? 'update' : 'upsert', rows: changed })
    if (removed.length) {
      deletes.unshift({ table, kind: 'delete', keys: removed.map((row) => pick(row, KEY_COLUMNS[table])) })
    }
  }
  return [...writes, ...deletes]
}

/** Only the weeks from `sinceWeek` on keep their check-ins (the same window the app loads). */
export function recentRows(rows, sinceWeek) {
  return { ...rows, checkins: rows.checkins.filter((row) => row.week >= sinceWeek) }
}
