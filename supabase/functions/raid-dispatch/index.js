// Sends queued Discord messages: roster posts (which follow each saved publication) and reminders.
// An officer's browser asks for its own guild right after saving; a scheduler, holding the shared
// RAID_DISPATCH_SECRET, also queues due reminders and drains every guild.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { deliverMessages, reminderMessages, rosterMessages } from '../_shared/raid-service-core.js'
import { rosterComponents } from '../_shared/discord-interactions.js'
import { checkChannelInServer } from '../_shared/discord-connect.js'
import { isGuildOfficer } from '../_shared/officer.js'

const URL_ = Deno.env.get('SUPABASE_URL')
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})
const SCHEDULER_SECRET = Deno.env.get('RAID_DISPATCH_SECRET') ?? ''
// Bot channels (with response buttons) need the application's bot token and the app's public address.
const BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN') ?? ''
const APP_URL = Deno.env.get('WHENTORAID_APP_URL') ?? ''
/** Bounded work per call keeps each run well inside the function time limit. */
const MAX_DELIVERIES = 10
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function rpc(name, args) {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}

function timingSafeEqual(a, b) {
  if (!a || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** What to send for one claimed job, or null when the job no longer needs a message. */
async function messagesFor(job) {
  if (job.kind === 'roster') {
    if (job.action === 'delete') return { messages: [], mentionIds: [] }
    const quiet = job.payload.cancelled || job.payload.withdrawn || !job.mention_players
    const mentionIds = quiet ? [] : job.payload.team.map((entry) => entry.discordId).filter(Boolean)
    return { messages: rosterMessages(job.payload, mentionIds), mentionIds }
  }
  // Reminder recipients are resolved now, so a late check-in or cancellation suppresses the nudge.
  const payload = await rpc('raid_reminder_payload', { p_id: job.id, p_lease: job.lease_token })
  if (!payload) return null
  const messages = reminderMessages(payload)
  if (!messages.length) return null
  return { messages, mentionIds: payload.recipients.map((r) => r.discordId).filter(Boolean) }
}

/** Channels confirmed to be in their guild's connected server during this request (cleared per request). */
const checkedChannels = new Set()

/**
 * A bot channel when the guild chose one, otherwise its webhook. The bot only posts in the server
 * the guild connected through Discord, so a typed channel id cannot reach another server.
 */
async function targetFor(job) {
  if (!job.channel_id) return job.webhook_url
  // Without the app address, roster posts would lose their buttons silently, so refuse instead.
  if (!BOT_TOKEN || !APP_URL) throw new Error('The WhenToRaid Discord bot is not configured on this server.')
  const key = `${job.guild_id}/${job.channel_id}`
  if (!checkedChannels.has(key)) {
    const { data, error } = await admin
      .from('guild_discord_servers')
      .select('server_id')
      .eq('guild_id', job.guild_id)
      .maybeSingle()
    if (error) throw new Error(`guild_discord_servers: ${error.message}`)
    await checkChannelInServer({ channelId: job.channel_id, serverId: data?.server_id, botToken: BOT_TOKEN })
    checkedChannels.add(key)
  }
  return { type: 'bot', channelId: job.channel_id, token: BOT_TOKEN }
}

async function finish(job, error = null) {
  await rpc('finish_discord_delivery', {
    p_id: job.id,
    p_lease: job.lease_token,
    p_version: job.version,
    p_error: error?.message ?? null,
    p_uncertain: Boolean(error?.uncertain),
    p_retry_seconds: Math.ceil(Number(error?.retryAfter) || 0),
  })
}

async function deliver(job) {
  let plan
  let failure = null
  try {
    plan = await messagesFor(job)
    if (plan) {
      await deliverMessages(await targetFor(job), plan.messages, job.message_ids ?? [], {
        mentionIds: plan.mentionIds,
        components: job.channel_id && job.kind === 'roster' ? rosterComponents(job, APP_URL) : [],
        checkpoint: (ids) =>
          rpc('checkpoint_discord_delivery', { p_id: job.id, p_lease: job.lease_token, p_message_ids: ids }),
      })
    }
  } catch (error) {
    console.error(`delivery ${job.id} failed:`, error.message)
    failure = error
  }
  // Recording the outcome is separate from sending: if it fails, the lease expires and the job is
  // marked uncertain for an officer to check, and the worker moves on to the next job.
  try {
    await finish(job, failure)
  } catch (error) {
    console.error(`delivery ${job.id} outcome not recorded:`, error.message)
  }
  if (!failure) return { id: job.id, status: plan ? 'sent' : 'skipped' }
  return { id: job.id, status: failure.uncertain ? 'uncertain' : 'retrying', error: failure.message }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  checkedChannels.clear()
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const body = await request.json().catch(() => ({}))
  const scheduler = timingSafeEqual(request.headers.get('x-raid-dispatch-secret') ?? '', SCHEDULER_SECRET)
  const guildId = typeof body?.guildId === 'string' ? body.guildId : null
  if (!scheduler) {
    if (!guildId || !/^[0-9a-f-]{36}$/i.test(guildId)) return json({ error: 'Choose a guild.' }, 400)
    if (!(await isGuildOfficer(request, guildId)))
      return json({ error: 'Only officers can send Discord messages.' }, 403)
  }
  try {
    if (scheduler) await rpc('enqueue_due_raid_reminders', {})
    const results = []
    for (let i = 0; i < MAX_DELIVERIES; i += 1) {
      const job = await rpc('claim_discord_delivery', { p_guild_id: scheduler ? null : guildId })
      if (!job) break
      results.push(await deliver(job))
    }
    return json({ results })
  } catch (error) {
    console.error('dispatch failed:', error.message)
    return json({ error: 'Discord delivery is temporarily unavailable. Your messages stay queued.' }, 503)
  }
})
