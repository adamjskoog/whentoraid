import { app } from '../app.svelte.js'
import { showToast } from '../toast.svelte.js'
import { inviteDetails, joinGuild, listGuilds } from './api.js'
import { supabase } from './client.js'
import { openGuild, remote } from './sync.svelte.js'

/**
 * Joining a guild from an invite link (`?join=<code>`). The code is kept for this tab while the
 * player signs in with Discord, since sign-in leaves the page and comes back without it.
 */

const INVITE_KEY = 'whentoraid-invite'
const CODE = /^[a-f0-9]{32}$/
const MAX_NAME = 30

export const invite = $state({
  code: null,
  /** @type {'idle' | 'loading' | 'ready' | 'joining' | 'error'} */
  status: 'idle',
  /** @type {{ guildId: string, guildName: string, openPlayers: { id: string, name: string }[] } | null} */
  details: null,
  error: null,
  /** The player's Discord display name, offered as their name in the guild. */
  suggestedName: '',
})

function store(code) {
  try {
    if (code) sessionStorage.setItem(INVITE_KEY, code)
    else sessionStorage.removeItem(INVITE_KEY)
  } catch {
    // Without storage, the invite is lost if sign-in leaves the page; opening the link again works.
  }
}

function stored() {
  try {
    return sessionStorage.getItem(INVITE_KEY)
  } catch {
    return null
  }
}

/** The code would otherwise stay in the address, in history, and in any link copied from it. */
function removeJoinParam() {
  const url = new URL(location.href)
  if (!url.searchParams.has('join')) return
  url.searchParams.delete('join')
  history.replaceState(history.state, '', url)
}

/** Take an invite code from the address (removing it from there) or from this tab's storage. */
export function captureInvite() {
  const fromUrl = location.search.match(/[?&]join=([^&]*)/)?.[1]?.toLowerCase()
  removeJoinParam()
  if (fromUrl && CODE.test(fromUrl)) store(fromUrl)
  const code = fromUrl && CODE.test(fromUrl) ? fromUrl : stored()
  if (!code || !CODE.test(code)) return
  Object.assign(invite, { code, status: 'idle', details: null, error: null })
}

async function discordName() {
  const { data } = await supabase.auth.getSession()
  const meta = data.session?.user?.user_metadata ?? {}
  const name = meta.custom_claims?.global_name ?? meta.full_name ?? meta.name ?? ''
  return String(name).trim().slice(0, MAX_NAME)
}

/** Look up the invite for the signed-in player; a guild they already belong to just opens. */
export async function loadInvite() {
  if (!invite.code || invite.status !== 'idle') return
  invite.status = 'loading'
  try {
    const [details, name] = await Promise.all([inviteDetails(supabase, invite.code), discordName()])
    if (details.alreadyMember) {
      dismissInvite()
      if (remote.guildId !== details.guildId) await openGuild(details.guildId)
      showToast(`You’re already in ${details.guildName}.`)
      return
    }
    Object.assign(invite, { status: 'ready', details, suggestedName: name })
  } catch (error) {
    Object.assign(invite, { status: 'error', error: error.message })
  }
}

/**
 * Join as the listed player `memberId`, or as a new player named `name`, then open the guild.
 * Throws a message fit for a toast; the invite stays open to try again.
 */
export async function acceptInvite({ memberId = null, name = '' }) {
  const offered = invite.details?.openPlayers ?? []
  if (memberId !== (offered[0]?.id ?? null) || offered.length > 1) {
    throw new Error('Ask an officer for a personal invite to this player.')
  }
  const trimmed = name.trim()
  if (!memberId && !trimmed) throw new Error('Enter the name your guild knows you by.')
  if (trimmed.length > MAX_NAME) throw new Error(`Names can be at most ${MAX_NAME} characters.`)
  const { code, details } = invite
  invite.status = 'joining'
  try {
    const guildId = await joinGuild(supabase, code, { memberId, name: trimmed })
    remote.guilds = await listGuilds(supabase)
    await openGuild(guildId)
  } catch (error) {
    invite.status = 'ready'
    throw error
  }
  dismissInvite()
  app.view = 'availability'
  showToast(`Welcome to ${details.guildName}! Mark when you can raid, then add your characters.`)
}

export function dismissInvite() {
  store(null)
  Object.assign(invite, { code: null, status: 'idle', details: null, error: null })
}
