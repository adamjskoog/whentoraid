// Adding the WhenToRaid bot to a guild's Discord server from Guild settings, and listing that
// server's channels for the officer to pick from. Officers only. Needs DISCORD_APPLICATION_ID,
// DISCORD_CLIENT_SECRET and DISCORD_BOT_TOKEN, and the app's discord-connect.html registered as an
// OAuth2 redirect in the Discord developer portal.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { ConnectError, handleConnect } from '../_shared/discord-connect.js'
import { isGuildOfficer } from '../_shared/officer.js'

const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function rpc(name, args) {
  const { error } = await admin.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
}

async function linkedServer(guildId) {
  const { data, error } = await admin
    .from('guild_discord_servers')
    .select('server_id')
    .eq('guild_id', guildId)
    .maybeSingle()
  if (error) throw new Error(`guild_discord_servers: ${error.message}`)
  return data?.server_id ?? null
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const body = await request.json().catch(() => ({}))
  const guildId = typeof body?.guildId === 'string' ? body.guildId : ''
  if (!/^[0-9a-f-]{36}$/i.test(guildId)) return json({ error: 'Choose a guild.' }, 400)
  if (!(await isGuildOfficer(request, guildId)))
    return json({ error: 'Only officers can connect Discord.' }, 403)
  try {
    return json(
      await handleConnect(body, {
        applicationId: Deno.env.get('DISCORD_APPLICATION_ID') ?? '',
        clientSecret: Deno.env.get('DISCORD_CLIENT_SECRET') ?? '',
        botToken: Deno.env.get('DISCORD_BOT_TOKEN') ?? '',
        appUrl: Deno.env.get('WHENTORAID_APP_URL') ?? '',
        rpc,
        linkedServer,
      }),
    )
  } catch (error) {
    if (error instanceof ConnectError) return json({ error: error.message }, error.status)
    console.error('discord-connect failed:', error.message)
    return json({ error: 'Discord could not be reached. Try again shortly.' }, 503)
  }
})
