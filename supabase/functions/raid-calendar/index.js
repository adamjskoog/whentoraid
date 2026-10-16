// A member's private calendar feed. Calendar apps cannot send sign-in headers, so the long random
// token in the address is the credential; the database stores only its hash and can revoke it.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { personalCalendar } from '../_shared/raid-service-core.js'

const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})

const notFound = () => new Response('This calendar link no longer works.', { status: 404 })

Deno.serve(async (request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('Method not allowed', { status: 405 })
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!/^[a-f0-9]{64}$/.test(token)) return notFound()
  const { data, error } = await admin.rpc('read_raid_calendar', { p_token: token })
  if (error) {
    // Never log the token itself.
    console.error('read_raid_calendar failed:', error.message)
    return new Response('The calendar is temporarily unavailable.', { status: 503 })
  }
  if (data === null) return notFound()
  return new Response(request.method === 'HEAD' ? null : personalCalendar(data), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
    },
  })
})
