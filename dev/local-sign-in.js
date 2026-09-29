import { discordUser, isLocalUrl, sessionToken } from './local-supabase.js'

/**
 * Dev-server-only test sign-in, for trying online guilds before a Discord application exists.
 * `GET /__local-sign-in?as=officer|player` returns a session for a fixed test player linked to a
 * made-up Discord ID. Tokens are signed with the local Supabase's development JWT secret, so they
 * are worthless against any hosted project.
 *
 * Guard rails: Vite applies the plugin only to `vite serve` (never to builds); it registers nothing
 * unless the configured Supabase is on this machine; and it answers only requests from this machine.
 */

const TEST_PLAYERS = {
  officer: { discordId: '100000000000000001', name: 'Test officer' },
  player: { discordId: '100000000000000002', name: 'Test player' },
}
const SESSION_SECONDS = 12 * 60 * 60
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

/** @param {string | undefined} supabaseUrl the app's VITE_SUPABASE_URL */
export function localSignIn(supabaseUrl) {
  return {
    name: 'whentoraid-local-sign-in',
    apply: 'serve',
    configureServer(server) {
      if (!isLocalUrl(supabaseUrl)) return
      server.middlewares.use('/__local-sign-in', async (req, res) => {
        if (req.method !== 'GET' || !LOOPBACK.has(req.socket.remoteAddress)) {
          send(res, 403, { error: 'Local test sign-in only answers this machine.' })
          return
        }
        const as = new URL(req.url, 'http://localhost').searchParams.get('as')
        const persona = TEST_PLAYERS[as]
        if (!persona) {
          send(res, 400, { error: 'Choose ?as=officer or ?as=player.' })
          return
        }
        try {
          const userId = await discordUser(persona.discordId, { name: persona.name })
          send(res, 200, {
            access_token: sessionToken(userId, SESSION_SECONDS),
            // Local sessions are not refreshed; sign in again after they expire.
            refresh_token: 'local-test-session',
            discordId: persona.discordId,
            name: persona.name,
          })
        } catch (error) {
          send(res, 500, { error: error.message })
        }
      })
    },
  }
}
