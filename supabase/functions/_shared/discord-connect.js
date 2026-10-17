/**
 * Adding the WhenToRaid bot to a Discord server from Guild settings, and choosing its channel.
 * Pure request handling shared by the discord-connect Edge Function (and raid-dispatch's channel
 * check) and executable Vitest tests; the database and Discord calls are injected.
 *
 * The server is never taken from the browser: Discord's OAuth2 token response for the bot install
 * names it, and only someone with Manage Server there can add the bot.
 */

const API = 'https://discord.com/api/v10'
const SNOWFLAKE = /^\d{17,20}$/
const ADMINISTRATOR = 1n << 3n
const VIEW_CHANNEL = 1n << 10n
const SEND_MESSAGES = 1n << 11n
const EMBED_LINKS = 1n << 14n
const POST = VIEW_CHANNEL | SEND_MESSAGES
/**
 * View Channel and Send Messages post and edit the bot's own messages; Embed Links shows sign-up
 * posts as cards. Servers that added the bot before cards existed must grant Embed Links themselves.
 */
export const BOT_PERMISSIONS = String(POST | EMBED_LINKS)
/** Text and announcement channels. */
const POSTABLE_TYPES = new Set([0, 5])
const CATEGORY = 4
const ROLE_OVERWRITE = 0
const MEMBER_OVERWRITE = 1

export class ConnectError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

/**
 * The redirect back from Discord: the static discord-connect.html next to the app (so Supabase
 * sign-in never sees the code). Only the app's own address, or a dev server on this computer.
 */
export function validRedirectUri(value, appUrl) {
  try {
    const url = new URL(value)
    if (url.search || url.hash || url.username || url.password) return false
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
      return url.pathname.endsWith('/discord-connect.html')
    return Boolean(appUrl) && url.href === new URL('discord-connect.html', appUrl).href
  } catch {
    return false
  }
}

/** Discord's "add to server" screen for the bot, returning an OAuth2 code to `redirectUri`. */
export function authorizeUrl({ applicationId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: applicationId,
    scope: 'bot',
    permissions: BOT_PERMISSIONS,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  })
  return `https://discord.com/oauth2/authorize?${params}`
}

/** The server the bot was just added to, from Discord's token response for the install code. */
export async function exchangeInstallCode({
  applicationId,
  clientSecret,
  code,
  redirectUri,
  fetchFn = fetch,
}) {
  const response = await fetchFn(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: applicationId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })
  if (!response.ok) throw new ConnectError('Discord did not accept that connection. Add the bot again.', 502)
  const guild = (await response.json())?.guild
  if (!SNOWFLAKE.test(guild?.id ?? ''))
    throw new ConnectError('Discord did not say which server the bot joined.', 502)
  return { id: guild.id, name: String(guild.name ?? '').slice(0, 100) }
}

/** GET a bot API path. A 403 or 404 means the bot cannot see it, usually because it was removed. */
export async function discordGet(path, botToken, fetchFn = fetch) {
  const response = await fetchFn(`${API}${path}`, { headers: { Authorization: `Bot ${botToken}` } })
  // A rejected token is a setup problem waiting will not fix: the site's bot token was reset or mistyped.
  if (response.status === 401)
    throw new ConnectError(
      'Discord rejected the WhenToRaid bot token. Whoever runs this site needs to reset the token in the Discord developer portal and save it as DISCORD_BOT_TOKEN.',
      503,
    )
  if (response.status === 403 || response.status === 404)
    throw new ConnectError('The WhenToRaid bot is no longer in that Discord server. Add it again.', 409)
  if (!response.ok) throw new ConnectError('Discord could not be reached. Try again shortly.', 502)
  return response.json()
}

/** Whether a member with these roles can view and send messages in a channel (Discord's own rules). */
export function canPost(member) {
  return hasChannelPermissions(member, POST)
}

/** Whether a member with these roles holds every permission in `needed` in a channel. */
function hasChannelPermissions({ serverId, memberId, memberRoleIds, roles, channel }, needed) {
  const rolePermissions = new Map(roles.map((role) => [role.id, BigInt(role.permissions ?? 0)]))
  let permissions = rolePermissions.get(serverId) ?? 0n
  for (const id of memberRoleIds) permissions |= rolePermissions.get(id) ?? 0n
  if (permissions & ADMINISTRATOR) return true
  const overwrites = channel.permission_overwrites ?? []
  const apply = (allow, deny) => {
    permissions = (permissions & ~deny) | allow
  }
  const everyone = overwrites.find((o) => o.type === ROLE_OVERWRITE && o.id === serverId)
  if (everyone) apply(BigInt(everyone.allow ?? 0), BigInt(everyone.deny ?? 0))
  let allow = 0n
  let deny = 0n
  for (const o of overwrites) {
    if (o.type !== ROLE_OVERWRITE || !memberRoleIds.includes(o.id)) continue
    allow |= BigInt(o.allow ?? 0)
    deny |= BigInt(o.deny ?? 0)
  }
  apply(allow, deny)
  const own = overwrites.find((o) => o.type === MEMBER_OVERWRITE && o.id === memberId)
  if (own) apply(BigInt(own.allow ?? 0), BigInt(own.deny ?? 0))
  return (permissions & needed) === needed
}

/**
 * The server's text channels in Discord's order, each marked with whether the bot can post there
 * and whether it can also show sign-up cards (Embed Links).
 */
export async function listChannels({ serverId, botToken, fetchFn = fetch }) {
  const get = (path) => discordGet(path, botToken, fetchFn)
  const bot = await get('/users/@me')
  const [member, roles, channels] = await Promise.all([
    get(`/guilds/${serverId}/members/${bot.id}`),
    get(`/guilds/${serverId}/roles`),
    get(`/guilds/${serverId}/channels`),
  ])
  const categories = new Map(channels.filter((c) => c.type === CATEGORY).map((c) => [c.id, c]))
  const order = (c) => {
    const category = categories.get(c.parent_id)
    return [category ? category.position : -1, c.position ?? 0]
  }
  return channels
    .filter((c) => POSTABLE_TYPES.has(c.type))
    .sort((a, b) => {
      const [ca, pa] = order(a)
      const [cb, pb] = order(b)
      return ca - cb || pa - pb
    })
    .map((c) => {
      const self = { serverId, memberId: bot.id, memberRoleIds: member.roles ?? [], roles, channel: c }
      return {
        id: c.id,
        name: c.name,
        category: categories.get(c.parent_id)?.name ?? '',
        canPost: canPost(self),
        canEmbed: hasChannelPermissions(self, POST | EMBED_LINKS),
      }
    })
}

/** Refuse a bot channel outside the guild's connected server, before the bot posts there. */
export async function checkChannelInServer({
  channelId,
  serverId,
  botToken,
  needEmbeds = false,
  fetchFn = fetch,
}) {
  if (!serverId) throw new Error('Add WhenToRaid to your Discord server in Guild settings → Connections.')
  // A channel the bot cannot see counts as outside the server; a bad token or outage is reported as is.
  const get = (path) => discordGet(path, botToken, fetchFn)
  const channel = await get(`/channels/${channelId}`).catch((error) => {
    if (error.status === 409) return null
    throw error
  })
  if (channel?.guild_id !== serverId)
    throw new Error(
      'The bot channel is not in your connected Discord server. Choose it again in Guild settings.',
    )
  if (!needEmbeds) return
  // Without Embed Links Discord drops a card silently, leaving an empty post.
  const bot = await get('/users/@me')
  const [member, roles] = await Promise.all([
    get(`/guilds/${serverId}/members/${bot.id}`),
    get(`/guilds/${serverId}/roles`),
  ])
  const self = { serverId, memberId: bot.id, memberRoleIds: member.roles ?? [], roles, channel }
  if (!hasChannelPermissions(self, POST | EMBED_LINKS))
    throw new Error(
      'Sign-up cards need the Embed Links permission. In Discord, give the WhenToRaid bot (or its role) Embed Links in the bot channel, then post the sign-up again.',
    )
}

/**
 * One officer request from Guild settings, after the caller checked the officer:
 * `start` returns Discord's add-bot URL, `link` records the server from the returned code, and
 * `channels` lists the connected server's channels.
 * @param {{ action: string, guildId: string, redirectUri?: string, state?: string, code?: string }} body
 * @param {{ applicationId: string, clientSecret: string, botToken: string, appUrl: string,
 *   fetchFn?: typeof fetch,
 *   rpc: (name: string, args: object) => Promise<unknown>,
 *   linkedServer: (guildId: string) => Promise<string | null> }} config
 */
export async function handleConnect(body, config) {
  const { applicationId, clientSecret, botToken, appUrl, rpc, linkedServer, fetchFn = fetch } = config
  if (!applicationId || !clientSecret || !botToken)
    throw new ConnectError('The WhenToRaid Discord bot is not set up on this site.', 503)
  const { action, guildId, redirectUri, state, code } = body
  if (action === 'start') {
    if (!validRedirectUri(redirectUri, appUrl)) throw new ConnectError('Invalid return address.')
    if (typeof state !== 'string' || !/^[\w-]{16,100}$/.test(state))
      throw new ConnectError('Invalid request.')
    return { url: authorizeUrl({ applicationId, redirectUri, state }) }
  }
  if (action === 'link') {
    if (!validRedirectUri(redirectUri, appUrl)) throw new ConnectError('Invalid return address.')
    if (typeof code !== 'string' || !/^[\w-]{10,100}$/.test(code)) throw new ConnectError('Invalid request.')
    const server = await exchangeInstallCode({ applicationId, clientSecret, code, redirectUri, fetchFn })
    await rpc('link_discord_server', {
      p_guild_id: guildId,
      p_server_id: server.id,
      p_server_name: server.name,
    })
    return { serverId: server.id, serverName: server.name }
  }
  if (action === 'channels') {
    const serverId = await linkedServer(guildId)
    if (!serverId) throw new ConnectError('Add WhenToRaid to your Discord server first.', 409)
    return { channels: await listChannels({ serverId, botToken, fetchFn }) }
  }
  throw new ConnectError('Unknown action.')
}
