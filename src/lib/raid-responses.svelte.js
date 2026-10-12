import {
  listRaidResponses,
  localRaidResponses,
  responsesByMember,
  saveLocalRaidResponse,
  saveRaidResponse,
} from './raid-services.js'
import { supabase } from './remote/client.js'
import { remote } from './remote/sync.svelte.js'

/**
 * Responses to one published raid: an online guild keeps them on the server (players see only
 * their own, officers see everyone's), a browser guild keeps them in this browser.
 */

const currentGuildKey = () => remote.guildId ?? 'browser'
const online = () => Boolean(remote.guildId && supabase)

/** Identifies one raid's publication, so a slow load for another raid is discarded. */
export const responseKey = (week, raidId, published) =>
  JSON.stringify([currentGuildKey(), week, raidId, String(published?.publishedAt)])

/**
 * Online, the server saves a response for whoever is signed in, so an officer acting as another
 * player cannot answer for them. A browser guild has one person at the keyboard.
 */
export const canRespondAs = (memberId) => !online() || memberId === remote.memberId

/**
 * @param {string} week
 * @param {string} raidId
 * @param {{ publishedAt: number, start: number, end: number, team: object[] }} published
 * @returns {Promise<Record<string, { member_id: string, status: string, note: string }>>}
 */
export async function loadRaidResponses(week, raidId, published) {
  const rows = online()
    ? await listRaidResponses(supabase, remote.guildId, week, raidId)
    : localRaidResponses(currentGuildKey(), week, raidId)
  return responsesByMember(rows, published)
}

/** Save a player's response; online, the server checks the signed-in player is rostered. */
export async function respondToRaid({ week, raidId, published, memberId, status, note = '' }) {
  if (online()) {
    await saveRaidResponse(supabase, remote.guildId, week, raidId, published.publishedAt, status, note)
    return
  }
  try {
    saveLocalRaidResponse(currentGuildKey(), week, raidId, memberId, published, status, note)
  } catch (error) {
    if (error instanceof DOMException)
      throw new Error('Browser storage is unavailable, so the response cannot be saved.', { cause: error })
    throw error
  }
}
