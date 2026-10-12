import { isWebhookUrl } from './discord-webhook.js'
import { getGuildDiscord, recordDiscordPost, setGuildDiscord } from './remote/api.js'
import { supabase } from './remote/client.js'
import { remote } from './remote/sync.svelte.js'

/**
 * The Discord channel rosters are posted to, for officers. It is kept out of the guild data every
 * player loads, since its webhook URL lets anyone post to the channel: an online guild keeps it in
 * an officer-only table, a browser guild in this browser only (not in backups).
 */

const LOCAL_KEY = 'whentoraid-discord-channel'
/** Posts for weeks older than this are forgotten, as on the server. */
const KEEP_POST_DAYS = 90
const EMPTY = { webhookUrl: '', mentionPlayers: false, posts: {} }

export const discordChannel = $state({
  /** Which guild the values below belong to: an online guild's id, or "browser". */
  guildKey: null,
  loaded: false,
  error: null,
  ...EMPTY,
})

const currentGuildKey = () => remote.guildId ?? 'browser'

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null')
  } catch {
    return null
  }
}

function writeLocal(value) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(value))
  } catch {
    throw new Error('Browser storage is unavailable, so the Discord channel cannot be saved.')
  }
}

function recentPosts(posts) {
  const cutoff = new Date(Date.now() - KEEP_POST_DAYS * 86400000).toISOString().slice(0, 10)
  return Object.fromEntries(Object.entries(posts ?? {}).filter(([key]) => key.slice(0, 10) >= cutoff))
}

/** Load the open guild's channel, unless it is already loaded. */
export async function loadDiscordChannel({ force = false } = {}) {
  const key = currentGuildKey()
  if (!force && discordChannel.guildKey === key && discordChannel.loaded) return
  Object.assign(discordChannel, EMPTY, { guildKey: key, loaded: false, error: null })
  try {
    const stored = remote.guildId ? await getGuildDiscord(supabase, remote.guildId) : readLocal()
    if (currentGuildKey() !== key) return
    Object.assign(discordChannel, EMPTY, stored ?? {}, { loaded: true })
  } catch (error) {
    if (currentGuildKey() !== key) return
    discordChannel.error = error.message
  }
}

/** Save the channel; an empty URL removes it. Throws a message fit for a toast. */
export async function saveDiscordChannel({ webhookUrl, mentionPlayers }) {
  const url = webhookUrl.trim()
  if (url && !isWebhookUrl(url)) {
    throw new Error('That is not a Discord webhook URL. Copy it from the channel’s Integrations settings.')
  }
  const sameUrl = url === discordChannel.webhookUrl
  const posts = url && sameUrl ? recentPosts(discordChannel.posts) : {}
  if (remote.guildId) {
    await setGuildDiscord(supabase, remote.guildId, { webhookUrl: url, mentionPlayers })
  } else if (url) {
    writeLocal({ webhookUrl: url, mentionPlayers, posts })
  } else {
    try {
      localStorage.removeItem(LOCAL_KEY)
    } catch {
      // Nothing was stored.
    }
  }
  Object.assign(discordChannel, { webhookUrl: url, mentionPlayers: Boolean(url && mentionPlayers), posts })
}

/** Remember (or, with no ids, forget) the messages holding one raid's posted roster. */
export async function rememberPost(key, messageIds) {
  const others = Object.fromEntries(Object.entries(discordChannel.posts).filter(([k]) => k !== key))
  const posts = recentPosts(messageIds.length ? { ...others, [key]: messageIds } : others)
  if (remote.guildId) await recordDiscordPost(supabase, remote.guildId, key, messageIds)
  else
    writeLocal({
      webhookUrl: discordChannel.webhookUrl,
      mentionPlayers: discordChannel.mentionPlayers,
      posts,
    })
  discordChannel.posts = posts
}

/** The key a raid's posted roster is remembered under. */
export const postKey = (week, raidId) => `${week}/${raidId}`
