import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

/**
 * Helpers for tests against the local Supabase from `npx supabase start`. Real Discord OAuth
 * cannot run in a test, so each player is created through the admin API, linked to a Discord
 * identity directly in the database, and given a session token signed with the local stack's
 * JWT secret (a public development default). Email login stays disabled, as in production.
 */

function localEnv() {
  const text = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', shell: true })
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => /^(\w+)="?([^"]*)"?$/.exec(line.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  )
}

const env = localEnv()
export const API_URL = env.API_URL
const PUBLISHABLE_KEY = env.PUBLISHABLE_KEY ?? env.ANON_KEY
const SECRET_KEY = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY
const JWT_SECRET = env.JWT_SECRET
const SESSION_SECONDS = 3600
const DB_CONTAINER = 'supabase_db_whentoraid'

const admin = createClient(API_URL, SECRET_KEY, { auth: { persistSession: false } })

function sql(statement) {
  execFileSync('docker', [
    'exec',
    DB_CONTAINER,
    'psql',
    '-U',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    statement,
  ])
}

const base64url = (value) => Buffer.from(value).toString('base64url')

/** An access token like the one Supabase Auth issues after sign-in. */
function sessionToken(userId) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + SESSION_SECONDS,
  }
  const body = `${header}.${base64url(JSON.stringify(claims))}`
  return `${body}.${createHmac('sha256', JWT_SECRET).update(body).digest('base64url')}`
}

/** A signed-in client for a new player whose Discord user ID is `discordId`. */
export async function signedInPlayer(discordId) {
  const email = `player-${discordId}-${Date.now()}@example.test`
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (error) throw error
  sql(
    `insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
     values ('${data.user.id}', 'discord', '${discordId}', '{"sub": "${discordId}"}', now(), now(), now())`,
  )
  return createClient(API_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false },
    accessToken: async () => sessionToken(data.user.id),
  })
}

/** A Discord-shaped user ID unique to this run. */
export function discordId() {
  return String(
    100000000000000000n + BigInt(Math.floor(Math.random() * 1e15)) * 1000n + BigInt(Date.now() % 1000),
  )
}
