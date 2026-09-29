import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

/**
 * Node-only helpers for the local Supabase from `npm run db:start`, shared by the integration tests
 * and the dev server's test sign-in. Real Discord OAuth cannot run here, so players are created
 * through the admin API, linked to a Discord identity directly in the database, and given a session
 * token signed with the local stack's JWT secret (a public development default). Email login stays
 * disabled, as in production. Never import this from app code.
 */

const DB_CONTAINER = 'supabase_db_whentoraid'
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

/** Whether `url` points at a Supabase on this machine. */
export function isLocalUrl(url) {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

let cached = null

/** URLs and keys of the running local stack, from `supabase status`. */
export function localSupabase() {
  if (cached) return cached
  const text = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', shell: true })
  const env = Object.fromEntries(
    text
      .split('\n')
      .map((line) => /^(\w+)="?([^"]*)"?$/.exec(line.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  )
  if (!isLocalUrl(env.API_URL)) throw new Error('The local Supabase is not running. Run `npm run db:start`.')
  cached = {
    apiUrl: env.API_URL,
    publishableKey: env.PUBLISHABLE_KEY ?? env.ANON_KEY,
    jwtSecret: env.JWT_SECRET,
    admin: createClient(env.API_URL, env.SECRET_KEY ?? env.SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    }),
  }
  return cached
}

/** Run SQL as the database owner; returns trimmed, unaligned output. */
function sql(statement) {
  return execFileSync(
    'docker',
    ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', statement],
    { encoding: 'utf8' },
  ).trim()
}

const DISCORD_ID = /^\d{17,20}$/
const base64url = (value) => Buffer.from(value).toString('base64url')

/** An access token like the one Supabase Auth issues after sign-in. */
export function sessionToken(userId, seconds = 3600) {
  const { jwtSecret } = localSupabase()
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const claims = { sub: userId, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + seconds }
  const body = `${header}.${base64url(JSON.stringify(claims))}`
  return `${body}.${createHmac('sha256', jwtSecret).update(body).digest('base64url')}`
}

/**
 * The user signed in with Discord user ID `discordId`, created (with that Discord identity) on
 * first use. @returns {Promise<string>} the Supabase user id
 */
export async function discordUser(discordId, { email, name } = {}) {
  if (!DISCORD_ID.test(discordId)) throw new Error('Discord user IDs are 17–20 digits.')
  const existing = sql(
    `select user_id from auth.identities where provider = 'discord' and provider_id = '${discordId}' limit 1`,
  )
  if (existing) return existing

  const { admin } = localSupabase()
  const { data, error } = await admin.auth.admin.createUser({
    email: email ?? `discord-${discordId}@whentoraid.local`,
    email_confirm: true,
    user_metadata: name ? { full_name: name } : {},
  })
  if (error) throw error
  sql(
    `insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
     values ('${data.user.id}', 'discord', '${discordId}', '{"sub": "${discordId}"}', now(), now(), now())`,
  )
  return data.user.id
}
