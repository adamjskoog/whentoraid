import { createClient } from '@supabase/supabase-js'

/**
 * The Supabase client, or null when this build has no backend configured. Without one, WhenToRaid
 * runs exactly as before: one guild, saved in this browser. The publishable key is meant to be
 * public; row-level security in the database decides what each signed-in player may do.
 */
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/** The backend is a Supabase on this machine (`npm run db:start`), so dev-only test sign-in may run. */
export const isLocalBackend = /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url ?? '')

export const supabase =
  url && key
    ? createClient(url, key, {
        // PKCE returns `?code=` rather than tokens in the URL hash, which the page routes use.
        auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
      })
    : null
