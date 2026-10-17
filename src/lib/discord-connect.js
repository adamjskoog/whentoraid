/**
 * Adding the WhenToRaid bot to an online guild's Discord server, from Guild settings → Connections.
 * Discord sends the officer back to public/discord-connect.html, which stores the result in this
 * tab's session storage and reopens the app; Guild settings then finishes the connection.
 */

/** Written here before leaving for Discord: the request's random state and the guild it is for. */
const START_KEY = 'whentoraid-discord-connect'
/** Written by discord-connect.html on the way back: Discord's code, state, or error. */
const RETURN_KEY = 'whentoraid-discord-return'

/** Session storage, or null where the browser blocks it. */
function session() {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

function read(storage, key) {
  try {
    return JSON.parse(storage?.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

function forget(storage, key) {
  try {
    storage?.removeItem(key)
  } catch {
    // Nothing was stored.
  }
}

/** Where Discord sends the officer back: the static page next to the app. */
export const connectRedirectUri = (href = globalThis.location.href) =>
  new URL('discord-connect.html', href).href

async function invoke(client, body) {
  const { data, error } = await client.functions.invoke('discord-connect', { body })
  if (!error) return data
  const message = await Promise.resolve(error.context?.json?.())
    .then((payload) => payload?.error)
    .catch(() => null)
  throw new Error(message || 'Discord could not be reached. Try again shortly.', { cause: error })
}

/** Leave for Discord's "add to server" screen. */
export async function startDiscordConnect(client, guildId, { storage = session(), go } = {}) {
  const state = crypto.randomUUID()
  const { url } = await invoke(client, { action: 'start', guildId, redirectUri: connectRedirectUri(), state })
  try {
    if (!storage) throw new Error('No storage')
    storage.setItem(START_KEY, JSON.stringify({ state, guildId }))
  } catch {
    throw new Error('Browser storage is unavailable, so Discord cannot be connected from this window.')
  }
  ;(go ?? ((target) => globalThis.location.assign(target)))(url)
}

/** Whether this tab just came back from Discord's "add to server" screen. */
export const hasDiscordReturn = (storage = session()) => read(storage, RETURN_KEY) !== null

/**
 * Finish a connection this tab started: verify the returned state, then let the server confirm with
 * Discord which server the bot joined. Returns null when there is nothing to finish.
 * @returns {Promise<{ serverId: string, serverName: string } | null>}
 */
export async function finishDiscordConnect(client, guildId, { storage = session() } = {}) {
  const returned = read(storage, RETURN_KEY)
  if (!returned) return null
  const started = read(storage, START_KEY)
  forget(storage, RETURN_KEY)
  forget(storage, START_KEY)
  if (!started || started.state !== returned.state)
    throw new Error('That Discord connection could not be verified. Add the bot again.')
  if (started.guildId !== guildId)
    throw new Error('That Discord connection was for another guild. Open it and add the bot again.')
  if (returned.error || !returned.code) throw new Error('The bot was not added to a Discord server.')
  return invoke(client, { action: 'link', guildId, code: returned.code, redirectUri: connectRedirectUri() })
}

/**
 * The connected server's text channels, each with whether the bot can post there.
 * @returns {Promise<{ id: string, name: string, category: string, canPost: boolean }[]>}
 */
export async function listDiscordChannels(client, guildId) {
  return (await invoke(client, { action: 'channels', guildId })).channels ?? []
}

/** Enable or update guild-scoped slash commands in the verified connected server. */
export const enableDiscordCommands = (client, guildId) => invoke(client, { action: 'commands', guildId })
