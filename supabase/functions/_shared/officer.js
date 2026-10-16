import { createClient } from 'npm:@supabase/supabase-js@2.117.2'

/** Whether the signed-in caller is an officer of the guild, checked with their own JWT. */
export async function isGuildOfficer(request, guildId) {
  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return false
  const asUser = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  })
  const { data, error } = await asUser.rpc('is_guild_officer', { g: guildId })
  return !error && data === true
}
