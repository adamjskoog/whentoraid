import { createClient } from '@supabase/supabase-js'
import { discordUser, localSupabase, sessionToken } from '../dev/local-supabase.js'

/** Helpers for tests against the local Supabase from `npm run db:start`. */

/** A signed-in client for a new player whose Discord user ID is `discordId`. */
export async function signedInPlayer(discordId) {
  const userId = await discordUser(discordId, { email: `player-${discordId}-${Date.now()}@example.test` })
  const { apiUrl, publishableKey } = localSupabase()
  return createClient(apiUrl, publishableKey, {
    auth: { persistSession: false },
    accessToken: async () => sessionToken(userId),
  })
}

/** A Discord-shaped user ID unique to this run. */
export function discordId() {
  return String(
    100000000000000000n + BigInt(Math.floor(Math.random() * 1e15)) * 1000n + BigInt(Date.now() % 1000),
  )
}
