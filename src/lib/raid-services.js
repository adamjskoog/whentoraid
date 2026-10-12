/** Player responses to a published roster. These never touch the guild-wide revision. */
async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

export const RESPONSE_STATUSES = ['confirmed', 'unavailable']
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

/** For the officer summary: every rostered player is confirmed, unavailable or still waiting. */
export function responseSummary(team, byMember) {
  const summary = { confirmed: [], unavailable: [], waiting: [] }
  for (const entry of team) {
    const status = byMember[entry.memberId]?.status
    summary[RESPONSE_STATUSES.includes(status) ? status : 'waiting'].push(entry)
  }
  return summary
}
