/**
 * Sends queued Discord messages: roster posts, sign-up posts and reminders. Shared by raid-dispatch
 * (the scheduler and officers' browsers) and raid-interactions (which refreshes a sign-up post right
 * after a press). Storage, the channel check and network calls are injected, so Vitest runs it too.
 */
import { deliverMessages, reminderMessages, rosterMessages } from './raid-service-core.js'
import { signupMessages } from './signup-post.js'
import { rosterComponents, signupComponents } from './discord-interactions.js'
import { checkChannelInServer } from './discord-connect.js'

/** Bounded work per call keeps each run well inside the function time limit. */
export const MAX_DELIVERIES = 10

/** What to send for one claimed job, or null when the job no longer needs a message. */
async function messagesFor(job, { rpc, appUrl }) {
  if (job.kind === 'roster') {
    if (job.action === 'delete') return { messages: [], mentionIds: [], components: [] }
    const quiet = job.payload.cancelled || job.payload.withdrawn || !job.mention_players
    const mentionIds = quiet ? [] : job.payload.team.map((entry) => entry.discordId).filter(Boolean)
    const components = job.channel_id ? rosterComponents(job, appUrl) : []
    return { messages: rosterMessages(job.payload, mentionIds), mentionIds, components }
  }
  if (job.kind === 'signup') {
    // Sign-ups are read now, so the post shows every press made before this send.
    const payload = await rpc('raid_signup_payload', { p_id: job.id, p_lease: job.lease_token })
    if (!payload) return null
    // A raid that started before its post went out is not announced at all.
    if (payload.closed && !job.message_ids?.length) return null
    return {
      messages: signupMessages(payload),
      mentionIds: [],
      components: signupComponents(job, payload, appUrl),
    }
  }
  // Reminder recipients are resolved now, so a late check-in or cancellation suppresses the nudge.
  const payload = await rpc('raid_reminder_payload', { p_id: job.id, p_lease: job.lease_token })
  if (!payload) return null
  const messages = reminderMessages(payload)
  if (!messages.length) return null
  return { messages, mentionIds: payload.recipients.map((r) => r.discordId).filter(Boolean), components: [] }
}

/**
 * A bot channel when the guild chose one, otherwise its webhook. The bot only posts in the server
 * the guild connected through Discord, so a typed channel id cannot reach another server.
 */
async function targetFor(job, { botToken, appUrl, checkChannel, checked }) {
  if (!job.channel_id) return job.webhook_url
  // Without the app address, posts would lose their buttons silently, so refuse instead.
  if (!botToken || !appUrl) throw new Error('The WhenToRaid Discord bot is not configured on this server.')
  const key = `${job.guild_id}/${job.channel_id}`
  if (!checked.has(key)) {
    await checkChannel(job.guild_id, job.channel_id)
    checked.add(key)
  }
  return { type: 'bot', channelId: job.channel_id, token: botToken }
}

async function finish(job, error, rpc) {
  await rpc('finish_discord_delivery', {
    p_id: job.id,
    p_lease: job.lease_token,
    p_version: job.version,
    p_error: error?.message ?? null,
    p_uncertain: Boolean(error?.uncertain),
    p_retry_seconds: Math.ceil(Number(error?.retryAfter) || 0),
  })
}

async function deliver(job, context) {
  const { rpc, fetchFn, log } = context
  let plan
  let failure = null
  try {
    plan = await messagesFor(job, context)
    if (plan) {
      await deliverMessages(await targetFor(job, context), plan.messages, job.message_ids ?? [], {
        fetchFn,
        mentionIds: plan.mentionIds,
        components: plan.components,
        checkpoint: (ids) =>
          rpc('checkpoint_discord_delivery', { p_id: job.id, p_lease: job.lease_token, p_message_ids: ids }),
      })
    }
  } catch (error) {
    log(`delivery ${job.id} failed: ${error.message}`)
    failure = error
  }
  // Recording the outcome is separate from sending: if it fails, the lease expires and the job is
  // marked uncertain for an officer to check, and the worker moves on to the next job.
  try {
    await finish(job, failure, rpc)
  } catch (error) {
    log(`delivery ${job.id} outcome not recorded: ${error.message}`)
  }
  if (!failure) return { id: job.id, status: plan ? 'sent' : 'skipped' }
  return { id: job.id, status: failure.uncertain ? 'uncertain' : 'retrying', error: failure.message }
}

/**
 * Claim and send up to `max` queued deliveries, for one guild or (`guildId` null) every guild.
 * @param {{ rpc: (name: string, args: object) => Promise<any>, guildId?: string | null,
 *   botToken: string, appUrl: string, checkChannel: (guildId: string, channelId: string) => Promise<void>,
 *   fetchFn?: typeof fetch, max?: number, log?: (message: string) => void }} options
 */
export async function deliverQueued({
  rpc,
  guildId = null,
  botToken,
  appUrl,
  checkChannel,
  fetchFn = fetch,
  max = MAX_DELIVERIES,
  log = (message) => console.error(message),
}) {
  // Channels confirmed to be in their guild's connected server during this call.
  const context = { rpc, botToken, appUrl, checkChannel, fetchFn, log, checked: new Set() }
  const results = []
  for (let i = 0; i < max; i += 1) {
    const job = await rpc('claim_discord_delivery', { p_guild_id: guildId })
    if (!job) break
    results.push(await deliver(job, context))
  }
  return results
}

/** The production channel check: the channel must be in the Discord server the guild connected. */
export function connectedChannelCheck(admin, botToken) {
  return async (guildId, channelId) => {
    const { data, error } = await admin
      .from('guild_discord_servers')
      .select('server_id')
      .eq('guild_id', guildId)
      .maybeSingle()
    if (error) throw new Error(`guild_discord_servers: ${error.message}`)
    await checkChannelInServer({ channelId, serverId: data?.server_id, botToken })
  }
}
