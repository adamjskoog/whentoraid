import { memberById, STATE_VERSION } from '../model.js'
import { DEFAULT_RAID_ID, defaultRaids } from '../raids.js'

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
export const TABLES = ['guilds', 'members', 'characters', 'availability_templates', 'checkins', 'plans']

/** Each table's primary key within a guild. */
export const KEY_COLUMNS = {
  guilds: ['id'],
  members: ['guild_id', 'id'],
  characters: ['guild_id', 'id'],
  availability_templates: ['guild_id', 'member_id'],
  checkins: ['guild_id', 'week', 'member_id'],
  plans: ['guild_id', 'week', 'raid_id'],
}

/** @param {AppState} state @returns {Rows} */
/**
 * Arguments for create_online_guild from a guild in this browser (a new guild, the demo, or the
 * browser guild moved online). The member being acted as becomes the first officer, linked to the
 * signed-in Discord account.
 */
export function newGuildPayload(state, discordId) {
  const me = memberById(state, state.currentMemberId)
  const linked = {
    ...state,
    members: state.members.map((m) => {
      if (m.id === me.id) return { ...m, discordId, officer: true }
      // A Discord account belongs to one player per guild.
      return m.discordId === discordId ? { ...m, discordId: '' } : m
    }),
  }
  return {
    guild: {
      name: state.guild.name,
      timezone: state.guild.timezone,
      dayStartHour: state.guild.dayStartHour,
      slotsPerDay: state.guild.slotsPerDay,
      settings: { ...state.settings, ...(state.demoYear ? { demoYear: state.demoYear } : {}) },
      discordServerId: state.guild.discordServerId,
      officerRoleIds: state.guild.officerRoleIds,
    },
    me: { id: me.id, name: me.name, position: state.members.indexOf(me) },
    rows: stateToRows(linked, '00000000-0000-0000-0000-000000000000'),
  }
}

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
          raids: settings.raids,
          checkinDeadline: settings.checkinDeadline ?? null,
          trackAttendance: settings.trackAttendance === true,
          ...(state.demoYear ? { demoYear: state.demoYear } : {}),
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
      retired: Boolean(c.retired),
      position,
    })),
    availability_templates: Object.entries(state.templates ?? {}).map(([memberId, template]) => ({
      guild_id: guildId,
      member_id: memberId,
      template,
    })),
    checkins: weeks.flatMap(([week, { checkins }]) =>
      Object.entries(checkins).map(([memberId, checkin]) => ({
        guild_id: guildId,
        week,
        member_id: memberId,
        checked_in: checkin.checkedIn,
        ranges: checkin.ranges,
        declined: checkin.declined,
        raid_preferences: checkin.raids ?? {},
        availability: availabilityColumn(checkin),
      })),
    ),
    plans: weeks.flatMap(([week, data]) =>
      Object.entries(data.plans).map(([raidId, plan]) => ({
        guild_id: guildId,
        week,
        raid_id: raidId,
        start: plan.start,
        team: plan.team,
        locked: plan.locked ?? [],
        attendance: plan.attendance ?? {},
        cancelled: Boolean(plan.cancelled),
        published: plan.published ?? null,
      })),
    ),
  }
}

/** Check-in fields stored in the `availability` column; only fields the check-in has are written. */
const AVAILABILITY_FIELDS = {
  preferred: 'preferredRanges',
  tentative: 'tentativeRanges',
  absent: 'absentDates',
}

function availabilityColumn(checkin) {
  return Object.fromEntries(
    Object.entries(AVAILABILITY_FIELDS)
      .filter(([, field]) => checkin[field] !== undefined)
      .map(([column, field]) => [column, checkin[field]]),
  )
}

function availabilityFields(column) {
  return Object.fromEntries(
    Object.entries(AVAILABILITY_FIELDS)
      .filter(([key]) => column?.[key] !== undefined)
      .map(([key, field]) => [field, column[key]]),
  )
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
  const weekOf = (week) => (weeks[week] ??= { checkins: {}, plans: {} })
  for (const row of rows.checkins) {
    weekOf(row.week).checkins[row.member_id] = {
      checkedIn: row.checked_in,
      ranges: row.ranges,
      declined: row.declined,
      ...(Object.keys(row.raid_preferences ?? {}).length ? { raids: row.raid_preferences } : {}),
      ...availabilityFields(row.availability),
    }
  }
  for (const row of rows.plans) {
    weekOf(row.week).plans[row.raid_id ?? DEFAULT_RAID_ID] = {
      start: Number(row.start),
      team: row.team,
      locked: row.locked,
      attendance: row.attendance,
      cancelled: row.cancelled,
      published: row.published ?? null,
    }
  }
  const members = [...rows.members].sort(byPosition).map((m) => ({
    id: m.id,
    name: m.name,
    discordId: m.discord_id,
    officer: m.is_officer,
  }))
  const known = members.some((m) => m.id === viewer.currentMemberId)
  const raids = guild.settings.raids ?? defaultRaids(guild.settings.targets, guild.settings.durationSlots)
  return {
    version: STATE_VERSION,
    currentWeek: viewer.currentWeek,
    currentRaidId: raids.some((raid) => raid.id === viewer.currentRaidId)
      ? viewer.currentRaidId
      : (raids.find((raid) => raid.id === DEFAULT_RAID_ID) ?? raids[0]).id,
    ...(guild.settings.demoYear ? { demoYear: guild.settings.demoYear } : {}),
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
      raids,
      checkinDeadline: guild.settings.checkinDeadline ?? null,
      trackAttendance: guild.settings.trackAttendance === true,
    },
    members,
    templates: Object.fromEntries(
      (rows.availability_templates ?? []).map((row) => [row.member_id, row.template]),
    ),
    characters: [...rows.characters].sort(byPosition).map((c) => ({
      id: c.id,
      memberId: c.member_id,
      name: c.name,
      realm: c.realm,
      spec: c.spec,
      class: c.class,
      role: c.role,
      main: c.main,
      ...(c.retired ? { retired: true } : {}),
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
    const old = new Map((before[table] ?? []).map((row) => [keyOf(table, row), stableJson(row)]))
    const changed = (after[table] ?? []).filter((row) => old.get(keyOf(table, row)) !== stableJson(row))
    const kept = new Set((after[table] ?? []).map((row) => keyOf(table, row)))
    const removed = (before[table] ?? []).filter((row) => !kept.has(keyOf(table, row)))
    if (changed.length) writes.push({ table, kind: table === 'guilds' ? 'update' : 'upsert', rows: changed })
    if (removed.length) {
      deletes.unshift({ table, kind: 'delete', keys: removed.map((row) => pick(row, KEY_COLUMNS[table])) })
    }
  }
  return [...writes, ...deletes]
}

/**
 * Rebase local row edits onto a newer server snapshot. Divergent writes to the same record
 * require review; identical edits are harmless. In particular, never resurrect a deleted row.
 */
export function mergeRows(base, local, server, { reviewed = false } = {}) {
  const merged = {}
  const conflict = () => {
    throw Object.assign(
      new Error('Someone changed the same record. Your edit was not saved; review the latest version.'),
      { code: 'ROW_CONFLICT' },
    )
  }
  for (const table of TABLES) {
    const index = (rows) => new Map((rows[table] ?? []).map((row) => [keyOf(table, row), row]))
    const before = index(base)
    const ours = index(local)
    const theirs = index(server)
    const result = new Map(theirs)
    for (const key of new Set([...before.keys(), ...ours.keys()])) {
      const original = stableJson(before.get(key))
      const edited = stableJson(ours.get(key))
      const latest = stableJson(theirs.get(key))
      if (original === edited) continue
      if (!reviewed && latest !== original && latest !== edited) conflict()
      if (ours.has(key)) result.set(key, ours.get(key))
      else result.delete(key)
    }
    merged[table] = [...result.values()]
  }
  // A concurrent child insertion must not disappear through a parent's cascading delete.
  const members = new Set(merged.members.map((row) => `${row.guild_id}|${row.id}`))
  for (const table of ['characters', 'availability_templates', 'checkins']) {
    if (merged[table].some((row) => !members.has(`${row.guild_id}|${row.member_id}`))) conflict()
  }
  return merged
}

/** Only the weeks from `sinceWeek` on keep their check-ins (the same window the app loads). */
export function recentRows(rows, sinceWeek) {
  return { ...rows, checkins: rows.checkins.filter((row) => row.week >= sinceWeek) }
}
