// Discord's Interactions Endpoint URL for the WhenToRaid application: Confirm / Can't attend buttons
// on bot-posted rosters. Discord signs every request; nothing here trusts a caller-supplied identity.
// Needs DISCORD_PUBLIC_KEY and DISCORD_APPLICATION_ID; until both are set every request is refused.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleDiscordInteraction } from '../_shared/discord-interactions.js'

const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})
const PUBLIC_KEY = Deno.env.get('DISCORD_PUBLIC_KEY') ?? ''
const APPLICATION_ID = Deno.env.get('DISCORD_APPLICATION_ID') ?? ''

async function rpc(name, args) {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}

Deno.serve((request) => {
  if (!PUBLIC_KEY || !APPLICATION_ID)
    return new Response(JSON.stringify({ error: 'Discord responses are not configured.' }), { status: 503 })
  return handleDiscordInteraction(request, {
    publicKey: PUBLIC_KEY,
    applicationId: APPLICATION_ID,
    rpc,
    // Keep saving after the three-second acknowledgement has been returned to Discord.
    schedule: (work) => globalThis.EdgeRuntime?.waitUntil(work) ?? work,
    log: (message) => console.error(message),
  })
})
