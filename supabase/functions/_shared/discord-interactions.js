/**
 * Discord button presses on bot-posted rosters and sign-up posts. Pure request handling shared by
 * the raid-interactions Edge Function and executable Vitest tests; storage and network calls are
 * injected.
 *
 * Identity comes only from the signed interaction: the Discord user, server, channel and message.
 * The database then checks that message belongs to the guild's current delivery and that the user
 * may answer (respond_to_discord_raid for rosters, signup_from_discord for sign-ups).
 */

const SNOWFLAKE = /^\d{17,20}$/
const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
const SIGNUP_STATUS = '(signed|late|tentative|absent)'
/** `wtr:<delivery id>:<delivery version>:<status>`, at most 100 characters as Discord requires. */
const CUSTOM_ID = new RegExp(`^wtr:${UUID}:(\\d{1,15}):(confirmed|unavailable)$`)
/** `wts:<delivery id>:<status>` on a sign-up post. Not versioned: every sign-up edits the post. */
const SIGNUP_BUTTON_ID = new RegExp(`^wts:${UUID}:${SIGNUP_STATUS}$`)
/** `wtc:<delivery id>:<post message id>:<status>` on the private character menu. */
const SIGNUP_MENU_ID = new RegExp(`^wtc:${UUID}:(\\d{17,20}):${SIGNUP_STATUS}$`)
/** `wtp:<delivery id>:<post message id>` on the private "Change spec" menu. */
const SIGNUP_SPEC_ID = new RegExp(`^wtp:${UUID}:(\\d{17,20})$`)
/** A "Change spec" option's value: `<spec>|<role>`. */
const SPEC_VALUE = /^([^|]{1,40})\|(Tank|Healer|DPS)$/
/** Discord rejects replays older than this; so do we. */
const MAX_SKEW_MS = 5 * 60 * 1000

const PING = 1
const COMPONENT = 3
const PONG = 1
const DEFERRED_MESSAGE = 5
const DEFERRED_UPDATE = 6
const EPHEMERAL = 64
const BUTTON = 2
const STRING_SELECT = 3
const ACTION_ROW = 1
const STYLE_PRIMARY = 1
const STYLE_SECONDARY = 2
const STYLE_SUCCESS = 3
const STYLE_DANGER = 4
const STYLE_LINK = 5
/** Discord's limits for select menu options and their labels. */
const MAX_OPTIONS = 25
const MAX_LABEL = 100

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

/** Who pressed what, where: only from the signed interaction, on a message this application wrote. */
function signedContext(interaction, applicationId) {
  const userId = interaction.member?.user?.id
  const { guild_id: server, channel_id: channel, message } = interaction
  if (!SNOWFLAKE.test(server ?? '') || !SNOWFLAKE.test(userId ?? '') || !SNOWFLAKE.test(channel ?? ''))
    return null
  if (!SNOWFLAKE.test(message?.id ?? '') || message?.author?.id !== applicationId) return null
  if (!SNOWFLAKE.test(interaction.id ?? '')) return null
  return {
    p_interaction_id: interaction.id,
    p_discord_id: userId,
    p_discord_guild_id: server,
    p_channel_id: channel,
  }
}

/** The RPC arguments for a roster button pressed in a server channel, or null for anything else. */
export function parseRosterClick(interaction, applicationId) {
  const context = signedContext(interaction, applicationId)
  const { data } = interaction
  if (!context || data?.component_type !== BUTTON) return null
  const match = CUSTOM_ID.exec(data.custom_id ?? '')
  if (!match) return null
  return {
    ...context,
    p_message_id: interaction.message.id,
    p_delivery_id: match[1],
    p_version: Number(match[2]),
    p_status: match[3],
  }
}

/**
 * The RPC arguments for a sign-up button on the post, or a character chosen from the private menu
 * (which names the post it came from), or null for anything else.
 */
export function parseSignup(interaction, applicationId) {
  const context = signedContext(interaction, applicationId)
  const { data } = interaction
  if (!context) return null
  if (data?.component_type === BUTTON) {
    const match = SIGNUP_BUTTON_ID.exec(data.custom_id ?? '')
    if (!match) return null
    return {
      ...context,
      p_message_id: interaction.message.id,
      p_delivery_id: match[1],
      p_status: match[2],
      p_character_id: null,
    }
  }
  if (data?.component_type === STRING_SELECT) {
    const match = SIGNUP_MENU_ID.exec(data.custom_id ?? '')
    const [characterId] = Array.isArray(data.values) && data.values.length === 1 ? data.values : []
    if (!match || typeof characterId !== 'string' || !/^.{1,64}$/.test(characterId)) return null
    return {
      ...context,
      p_message_id: match[2],
      p_delivery_id: match[1],
      p_status: match[3],
      p_character_id: characterId,
    }
  }
  return null
}

/** The RPC arguments for a spec chosen from the private "Change spec" menu, or null for anything else. */
export function parseSpecChange(interaction, applicationId) {
  const context = signedContext(interaction, applicationId)
  const { data } = interaction
  if (!context || data?.component_type !== STRING_SELECT) return null
  const match = SIGNUP_SPEC_ID.exec(data.custom_id ?? '')
  const [value] = Array.isArray(data.values) && data.values.length === 1 ? data.values : []
  const choice = typeof value === 'string' ? SPEC_VALUE.exec(value) : null
  if (!match || !choice) return null
  return {
    ...context,
    p_message_id: match[2],
    p_delivery_id: match[1],
    p_spec: choice[1],
    p_role: choice[2],
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

const SIGNUP_OUTCOMES = {
  'no-characters': 'Add a character in WhenToRaid first, then press Sign up again.',
  'bad-character': 'That character is not one of yours any more. Press Sign up again.',
  closed: 'Sign-ups for this raid are closed: it has started or was cancelled.',
  duplicate: 'That press was already recorded.',
  unknown: 'This post is no longer connected to a WhenToRaid raid.',
  'not-signed': 'Sign up first, then change your spec.',
  'bad-spec': "That character can't play that spec. Choose another.",
}

const BENCH_ROLES = { Tank: 'tank', Healer: 'healer', DPS: 'DPS' }

function savedSignup({ status, raidName, character, class: className, spec, role, afterDeadline, standing }) {
  const raid = raidName || 'this raid'
  const details = [[spec, className].filter(Boolean).join(' '), role].filter(Boolean).join(', ')
  const as = character ? ` as ${character}${details ? ` (${details})` : ''}` : ''
  const text = {
    signed: `You're signed up for ${raid}${as}.`,
    late: `You're signed up for ${raid}${as}, arriving late.`,
    tentative: `You're down as tentative for ${raid}${as}.`,
    absent: `You're marked absent for ${raid}. Thanks for letting your officers know.`,
  }[status]
  if (!text) return null
  const parts = [text]
  if (standing?.bench && (status === 'signed' || status === 'late'))
    parts.push(
      `The ${BENCH_ROLES[standing.role] ?? 'role'} spots are full, so you're on the bench. Your officers decide who plays.`,
    )
  if (afterDeadline)
    parts.push('The check-in deadline has passed, so your officers will see this as a late change.')
  return parts.join(' ')
}

/** The "Change spec" menu under a confirmation, bound to the post; the spec in use is preselected. */
function specMenu(result, args) {
  if (result.status === 'absent' || !result.character || !result.specs?.length) return []
  const options = result.specs.slice(0, MAX_OPTIONS).map(({ spec, role }) => ({
    label: `${spec} · ${role}`.slice(0, MAX_LABEL),
    value: `${spec}|${role}`,
    ...(spec === result.spec && role === result.role ? { default: true } : {}),
  }))
  return [
    {
      type: ACTION_ROW,
      components: [
        {
          type: STRING_SELECT,
          custom_id: `wtp:${args.p_delivery_id}:${args.p_message_id}`,
          placeholder: 'Change spec for this raid',
          options,
        },
      ],
    },
  ]
}

/**
 * The private reply to a sign-up press: a confirmation (with a "Change spec" menu), an explanation,
 * or (`choose`) a menu of the player's characters bound to the post that was pressed. `components`
 * is always set, so choosing from a menu replaces it.
 */
export function signupReply(result, args = {}) {
  if (result?.outcome === 'choose') {
    const options = (result.characters ?? []).slice(0, MAX_OPTIONS).map((c) => ({
      label: `${c.name} — ${[c.spec, c.class].filter(Boolean).join(' ')}`.slice(0, MAX_LABEL),
      value: c.id,
      ...(c.role ? { description: c.role } : {}),
    }))
    return {
      content: 'Which character are you bringing?',
      components: [
        {
          type: ACTION_ROW,
          components: [
            {
              type: STRING_SELECT,
              custom_id: `wtc:${args.p_delivery_id}:${args.p_message_id}:${result.status}`,
              placeholder: 'Choose a character',
              options,
            },
          ],
        },
      ],
    }
  }
  if (result?.outcome === 'not-member') {
    const guild = result.guildName ? ` in ${result.guildName}` : ''
    return {
      content: `Your Discord account isn't a member${guild} on WhenToRaid yet. Ask an officer for an invite link.`,
      components: [],
    }
  }
  const saved = result?.outcome === 'saved' && savedSignup(result)
  if (saved) return { content: saved, components: specMenu(result, args) }
  const content =
    SIGNUP_OUTCOMES[result?.outcome] || 'Your sign-up could not be saved. Try again in a moment.'
  return { content, components: [] }
}

/**
 * Edit the deferred reply through the interaction's own webhook (no bot token needed): the private
 * "thinking" message, or for a menu choice the private menu itself. `message` is text, or
 * `{ content, components }`.
 */
export async function editOriginalResponse(interaction, message, fetchFn = fetch) {
  const url = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`
  const body = typeof message === 'string' ? { content: message } : message
  const response = await fetchFn(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }),
  })
  if (!response.ok) throw new Error(`Discord returned ${response.status} for the interaction reply.`)
}

/**
 * Handle one interaction request. Valid presses are acknowledged at once (Discord allows three
 * seconds) with a private "thinking" reply, or for a menu choice by updating that menu later;
 * `schedule` keeps the save, the follow-up and the post refresh running.
 * @param {Request} request
 * @param {{ publicKey: string, applicationId: string, now?: number,
 *   rpc: (name: string, args: object) => Promise<object>,
 *   followup?: (interaction: object, message: string | object) => Promise<void>,
 *   refresh?: (guildId: string) => Promise<unknown>,
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
  const signup = parseSignup(interaction, applicationId)
  if (signup) return handleSignup(interaction, 'signup_from_discord', signup, { ...config, followup, log })
  const specChange = parseSpecChange(interaction, applicationId)
  if (specChange)
    return handleSignup(interaction, 'signup_spec_from_discord', specChange, { ...config, followup, log })
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

/** Save a sign-up (or its spec), answer the player privately, then bring the public post up to date. */
function handleSignup(interaction, rpcName, args, { rpc, schedule, followup, refresh, log }) {
  schedule(
    (async () => {
      let result = null
      try {
        result = await rpc(rpcName, args)
      } catch (error) {
        log(`sign-up ${interaction.id} failed: ${error.message}`)
      }
      if (result?.outcome === 'saved' && (result.status === 'signed' || result.status === 'late')) {
        try {
          const standing = await rpc('signup_standing', {
            p_delivery_id: args.p_delivery_id,
            p_discord_id: args.p_discord_id,
          })
          result = { ...result, standing }
        } catch (error) {
          // The sign-up is saved; only the bench notice is missing.
          log(`sign-up ${interaction.id} standing failed: ${error.message}`)
        }
      }
      try {
        await followup(interaction, signupReply(result, args))
      } catch (error) {
        log(`sign-up ${interaction.id} reply failed: ${error.message}`)
      }
      if (result?.outcome !== 'saved' || !refresh) return
      try {
        await refresh(result.guildId)
      } catch (error) {
        // The post is queued either way; the scheduler sends it within minutes.
        log(`sign-up ${interaction.id} post refresh failed: ${error.message}`)
      }
    })(),
  )
  // A choice from the private menu updates that menu; a press on the post gets its own private reply.
  const fromMenu = interaction.data.component_type === STRING_SELECT
  return reply(fromMenu ? { type: DEFERRED_UPDATE } : { type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } })
}

/** The app page where a player sees the week they are signing up for. */
function weekLink(appUrl, job) {
  const base = new URL(appUrl)
  if (base.protocol !== 'https:') throw new Error('The app address must use HTTPS.')
  return `${base.origin}${base.pathname}?guild=${job.guild_id}#/availability/${job.week}`
}

/**
 * Buttons for a sign-up post: Sign up, Late, Tentative, Absent and a link to the week in the app.
 * A raid that started or was cancelled gets none.
 */
export function signupComponents(job, payload, appUrl) {
  if (payload?.closed || payload?.cancelled) return []
  const link = weekLink(appUrl, job)
  const button = (status, label, emoji, style) => ({
    type: BUTTON,
    style,
    label,
    emoji: { name: emoji },
    custom_id: `wts:${job.id}:${status}`,
  })
  return [
    {
      type: ACTION_ROW,
      components: [
        button('signed', 'Sign up', '✅', STYLE_SUCCESS),
        button('late', 'Late', '⏰', STYLE_PRIMARY),
        button('tentative', 'Tentative', '❔', STYLE_SECONDARY),
        button('absent', 'Absent', '❌', STYLE_DANGER),
        { type: BUTTON, style: STYLE_LINK, label: 'Open in WhenToRaid', url: link },
      ],
    },
  ]
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
