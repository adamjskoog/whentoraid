// Sends queued Discord messages: roster posts (which follow each saved publication), sign-up posts
// and reminders. An officer's browser asks for its own guild right after saving; a scheduler,
// holding the shared RAID_DISPATCH_SECRET, also queues due reminders and sign-up posts and drains
// every guild.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { connectedChannelCheck, deliverQueued } from '../_shared/delivery-worker.js'
import { isGuildOfficer } from '../_shared/officer.js'
import { createSpecEmojiLoader } from '../_shared/discord-spec-emojis.js'

const URL_ = Deno.env.get('SUPABASE_URL')
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})
const SCHEDULER_SECRET = Deno.env.get('RAID_DISPATCH_SECRET') ?? ''
// Bot channels (with response buttons) need the application's bot token and the app's public address.
const BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN') ?? ''
const APP_URL = Deno.env.get('WHENTORAID_APP_URL') ?? ''
const loadSpecEmojis = createSpecEmojiLoader({
  applicationId: Deno.env.get('DISCORD_APPLICATION_ID') ?? '',
  botToken: BOT_TOKEN,
})
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
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
    const results = await deliverQueued({
      rpc,
      guildId: scheduler ? null : guildId,
      botToken: BOT_TOKEN,
      appUrl: APP_URL,
      loadSpecEmojis,
      checkChannel: connectedChannelCheck(admin, BOT_TOKEN),
    })
    return json({ results })
  } catch (error) {
    console.error('dispatch failed:', error.message)
    return json({ error: 'Discord delivery is temporarily unavailable. Your messages stay queued.' }, 503)
  }
})
