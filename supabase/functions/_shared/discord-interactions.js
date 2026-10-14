/**
 * Discord button presses on bot-posted rosters. Pure request handling shared by the
 * raid-interactions Edge Function and executable Vitest tests; storage and network calls are injected.
 *
 * Identity comes only from the signed interaction: the Discord user, server, channel and message.
 * The database then checks that message belongs to the guild's current roster delivery and that the
 * user is a rostered member (respond_to_discord_raid).
 */

const SNOWFLAKE = /^\d{17,20}$/
/** `wtr:<delivery id>:<delivery version>:<status>`, at most 100 characters as Discord requires. */
const CUSTOM_ID =
  /^wtr:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{1,15}):(confirmed|unavailable)$/
/** Discord rejects replays older than this; so do we. */
const MAX_SKEW_MS = 5 * 60 * 1000

const PING = 1
const COMPONENT = 3
const PONG = 1
const DEFERRED_MESSAGE = 5
const EPHEMERAL = 64
const BUTTON = 2
const ACTION_ROW = 1
const STYLE_SUCCESS = 3
const STYLE_DANGER = 4
const STYLE_LINK = 5

/** Statuses as stored in raid_responses. */
export const RESPONSE_LABELS = { confirmed: 'Confirm', unavailable: "Can't attend" }

function hexBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 || !/^[0-9a-f]*$/i.test(hex)) return null
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16))
}

/** Ed25519 over `timestamp + body`, exactly as received. Stale or malformed requests are rejected. */
export async function verifyDiscordSignature({ publicKey, signature, timestamp, body, now = Date.now() }) {
  const key = hexBytes(publicKey)
  const sig = hexBytes(signature)
  if (!key || key.length !== 32 || !sig || sig.length !== 64) return false
  if (!/^\d{1,12}$/.test(timestamp ?? '') || Math.abs(now - Number(timestamp) * 1000) > MAX_SKEW_MS)
    return false
  try {
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify('Ed25519', cryptoKey, sig, new TextEncoder().encode(timestamp + body))
  } catch {
    return false
  }
}

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** The RPC arguments for a roster button pressed in a server channel, or null for anything else. */
export function parseRosterClick(interaction, applicationId) {
  const userId = interaction.member?.user?.id
  const { guild_id: server, channel_id: channel, message, data } = interaction
  if (!SNOWFLAKE.test(server ?? '') || !SNOWFLAKE.test(userId ?? '') || !SNOWFLAKE.test(channel ?? ''))
    return null
  if (!SNOWFLAKE.test(message?.id ?? '') || message?.author?.id !== applicationId) return null
  if (data?.component_type !== BUTTON) return null
  const match = CUSTOM_ID.exec(data.custom_id ?? '')
  if (!match || !SNOWFLAKE.test(interaction.id ?? '')) return null
  return {
    p_interaction_id: interaction.id,
    p_discord_id: userId,
    p_discord_guild_id: server,
    p_channel_id: channel,
    p_message_id: message.id,
    p_delivery_id: match[1],
    p_version: Number(match[2]),
    p_status: match[3],
  }
}

const OUTCOME_MESSAGES = {
  'not-member': 'Your Discord account is not a member of this guild in WhenToRaid.',
  'not-rostered': 'You are not on this published roster.',
  stale: 'This roster just changed. Use the updated post, or open the roster in WhenToRaid.',
  duplicate: 'That press was already recorded.',
  closed: 'This raid has started, was cancelled, or is no longer published.',
  unknown: 'This post is no longer connected to a WhenToRaid roster.',
}

/** The private reply for an outcome returned by respond_to_discord_raid. */
export function outcomeMessage(result) {
  if (result?.outcome === 'saved') {
    const raid = result.raidName ? ` for ${result.raidName}` : ''
    return result.status === 'confirmed'
      ? `You confirmed your place${raid}. Thanks!`
      : `Your officers can see you can't attend${raid}.`
  }
  return OUTCOME_MESSAGES[result?.outcome] ?? 'Your response could not be saved. Try again in WhenToRaid.'
}

/** Edit the deferred private reply through the interaction's own webhook (no bot token needed). */
export async function editOriginalResponse(interaction, content, fetchFn = fetch) {
  const url = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`
  const response = await fetchFn(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  })
  if (!response.ok) throw new Error(`Discord returned ${response.status} for the interaction reply.`)
}

/**
 * Handle one interaction request. Valid button presses are acknowledged at once with a private
 * "thinking" reply (Discord allows three seconds); `schedule` keeps the save and follow-up running.
 * @param {Request} request
 * @param {{ publicKey: string, applicationId: string, now?: number,
 *   rpc: (name: string, args: object) => Promise<object>,
 *   followup?: (interaction: object, content: string) => Promise<void>,
 *   schedule: (work: Promise<unknown>) => void,
 *   log?: (message: string) => void }} config
 */
export async function handleDiscordInteraction(request, config) {
  const { publicKey, applicationId, now = Date.now(), rpc, schedule } = config
  const followup = config.followup ?? editOriginalResponse
  const log = config.log ?? (() => {})
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)
  const body = await request.text()
  const verified = await verifyDiscordSignature({
    publicKey,
    signature: request.headers.get('x-signature-ed25519'),
    timestamp: request.headers.get('x-signature-timestamp'),
    body,
    now,
  })
  if (!verified) return reply({ error: 'Invalid request signature.' }, 401)

  let interaction
  try {
    interaction = JSON.parse(body)
  } catch {
    return reply({ error: 'Malformed interaction.' }, 400)
  }
  if (interaction?.application_id !== applicationId) return reply({ error: 'Wrong application.' }, 401)
  if (interaction.type === PING) return reply({ type: PONG })
  if (interaction.type !== COMPONENT) return reply({ error: 'Unsupported interaction.' }, 400)
  const args = parseRosterClick(interaction, applicationId)
  if (!args) return reply({ error: 'Unsupported interaction.' }, 400)

  schedule(
    (async () => {
      let content
      try {
        content = outcomeMessage(await rpc('respond_to_discord_raid', args))
      } catch (error) {
        log(`interaction ${interaction.id} failed: ${error.message}`)
        content = outcomeMessage(null)
      }
      try {
        await followup(interaction, content)
      } catch (error) {
        log(`interaction ${interaction.id} reply failed: ${error.message}`)
      }
    })(),
  )
  return reply({ type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } })
}

/**
 * Buttons for a bot-posted roster: respond, and open the published roster. Bound to the delivery
 * version, so presses on an outdated post are refused rather than applied to a changed roster.
 * Cancelled and withdrawn rosters get no buttons.
 */
export function rosterComponents(job, appUrl) {
  const base = new URL(appUrl)
  if (base.protocol !== 'https:') throw new Error('The app address must use HTTPS.')
  if (job.payload?.cancelled || job.payload?.withdrawn) return []
  const button = (status, style) => ({
    type: BUTTON,
    style,
    label: RESPONSE_LABELS[status],
    custom_id: `wtr:${job.id}:${job.version}:${status}`,
  })
  const link = `${base.origin}${base.pathname}?guild=${job.guild_id}#/published/${job.week}/${job.raid_id}`
  return [
    {
      type: ACTION_ROW,
      components: [
        button('confirmed', STYLE_SUCCESS),
        button('unavailable', STYLE_DANGER),
        { type: BUTTON, style: STYLE_LINK, label: 'View roster', url: link },
      ],
    },
  ]
}
