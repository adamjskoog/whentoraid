// Discord's Interactions Endpoint URL for the WhenToRaid application: Confirm / Can't attend buttons
// on bot-posted rosters, and Sign up / Late / Tentative / Absent on sign-up posts. Discord signs every
// request; nothing here trusts a caller-supplied identity.
// Needs DISCORD_PUBLIC_KEY and DISCORD_APPLICATION_ID; until both are set every request is refused.
// A sign-up also refreshes its post at once, which needs DISCORD_BOT_TOKEN and WHENTORAID_APP_URL
// (otherwise the post catches up on the next scheduled raid-dispatch run).
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { handleDiscordInteraction } from '../_shared/discord-interactions.js'
import { connectedChannelCheck, deliverQueued } from '../_shared/delivery-worker.js'

const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})
const PUBLIC_KEY = Deno.env.get('DISCORD_PUBLIC_KEY') ?? ''
const APPLICATION_ID = Deno.env.get('DISCORD_APPLICATION_ID') ?? ''
const BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN') ?? ''
const APP_URL = Deno.env.get('WHENTORAID_APP_URL') ?? ''
/** A press needs only its own post updated; anything else queued waits for the scheduler. */
const REFRESH_DELIVERIES = 3

async function rpc(name, args) {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}

// Without the bot settings a send would fail and use up the post's retries; the scheduler reports
// that problem instead.
const refresh = (guildId) =>
  !BOT_TOKEN || !APP_URL
    ? Promise.resolve([])
    : deliverQueued({
        rpc,
        guildId,
        botToken: BOT_TOKEN,
        appUrl: APP_URL,
        checkChannel: connectedChannelCheck(admin, BOT_TOKEN),
        max: REFRESH_DELIVERIES,
      })

Deno.serve((request) => {
  if (!PUBLIC_KEY || !APPLICATION_ID)
    return new Response(JSON.stringify({ error: 'Discord responses are not configured.' }), { status: 503 })
  return handleDiscordInteraction(request, {
    publicKey: PUBLIC_KEY,
    applicationId: APPLICATION_ID,
    appUrl: APP_URL,
    rpc,
    refresh,
    // Keep saving after the three-second acknowledgement has been returned to Discord.
    schedule: (work) => globalThis.EdgeRuntime?.waitUntil(work) ?? work,
    log: (message) => console.error(message),
  })
})
