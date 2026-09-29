import { app } from '../app.svelte.js'
import { CHECKIN_HISTORY_WEEKS, memberById } from '../model.js'
import { loadState } from '../storage.js'
import { addDays, mondayOf, todayIso } from '../time.js'
import { showToast } from '../toast.svelte.js'
import { applyOps, createGuild, fetchGuild, listGuilds, myDiscordId } from './api.js'
import { isLocalBackend, supabase } from './client.js'
import { diffRows, rowsToState, stateToRows, TABLES } from './rows.js'

/**
 * Online guilds. While a guild is open, `app.data` still holds the whole guild and every change
 * still goes through the pure model functions; App passes each new state to `pushChanges`, which
 * sends only the rows that changed. Realtime tells us when someone else changed something, and we
 * reload the guild. Row-level security on the server is the real permission check; `canManage`
 * only keeps the UI from offering what the server would refuse.
 */

const ACTIVE_GUILD_KEY = 'whentoraid-online-guild'
const RELOAD_DEBOUNCE_MS = 400
const RETRY_MS = 5000

export const remote = $state({
  /** A backend is configured for this build. */
  enabled: supabase !== null,
  /** Sign-in state is known (always true without a backend). */
  ready: supabase === null,
  signedIn: false,
  /** The signed-in player's Discord user ID, as verified by Supabase Auth. */
  discordId: null,
  /** @type {{ id: string, name: string }[]} */
  guilds: [],
  /** The open online guild, or null in browser-only mode. */
  guildId: null,
  /** The signed-in player's member id in the open guild. */
  memberId: null,
  officer: false,
  /** @type {'saved' | 'saving' | 'error'} */
  status: 'saved',
})

/** Rows the server is believed to hold for the open guild; changes are diffed against it. */
let shadow = null
let queue = Promise.resolve()
let pending = 0
let channel = null
let reloadTimer

/** Officers manage the guild; in browser-only mode, whoever holds the browser does. */
export function canManage() {
  return !remote.guildId || remote.officer
}

function storedGuildId() {
  try {
    return localStorage.getItem(ACTIVE_GUILD_KEY)
  } catch {
    return null
  }
}

function storeGuildId(guildId) {
  try {
    if (guildId) localStorage.setItem(ACTIVE_GUILD_KEY, guildId)
    else localStorage.removeItem(ACTIVE_GUILD_KEY)
  } catch {
    // Without storage the guild is simply not reopened on the next visit.
  }
}

/** Check-ins older than this are not loaded, matching what browser-only mode keeps. */
function sinceWeek() {
  return addDays(mondayOf(todayIso('UTC')), -7 * CHECKIN_HISTORY_WEEKS)
}

/** The sign-in round trip leaves `?code=` in the address; drop it once the session exists. */
function cleanAuthParams() {
  const url = new URL(location.href)
  if (!url.searchParams.has('code')) return
  url.searchParams.delete('code')
  history.replaceState(history.state, '', url)
}

/** Start following sign-in state. Call once, when the app starts. @returns {() => void} stop */
export function initRemote() {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    // Supabase warns against awaiting other Supabase calls inside this callback.
    setTimeout(() => onSession(session), 0)
  })
  return () => data.subscription.unsubscribe()
}

async function onSession(session) {
  const signedIn = Boolean(session)
  // Token refreshes also land here; only sign-in and sign-out change anything.
  if (remote.ready && signedIn === remote.signedIn) return
  remote.signedIn = signedIn
  if (!signedIn) {
    closeGuild()
    Object.assign(remote, { discordId: null, guilds: [], ready: true })
    return
  }
  cleanAuthParams()
  try {
    remote.discordId = await myDiscordId(supabase)
    remote.guilds = await listGuilds(supabase)
    const saved = storedGuildId()
    if (saved && remote.guilds.some((g) => g.id === saved)) await openGuild(saved)
  } catch (error) {
    showToast(error.message)
  } finally {
    remote.ready = true
  }
}

export async function signIn() {
  const redirectTo = `${location.origin}${location.pathname}`
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo } })
  if (error) showToast(error.message)
}

/** Dev server with a local Supabase: offer the test sign-in. False in every production build. */
export const localTestSignInAvailable = import.meta.env.DEV && isLocalBackend

/**
 * Sign in as the local test officer or test player (see dev/local-sign-in.js). Only the dev server
 * answers this, and only for a local Supabase.
 * @param {'officer' | 'player'} as
 */
export async function localTestSignIn(as) {
  if (!localTestSignInAvailable) return
  const response = await fetch(`/__local-sign-in?as=${as}`)
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? 'Local test sign-in failed.')
  const { error } = await supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  })
  if (error) throw new Error(error.message)
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) showToast(error.message)
}

/**
 * The viewer's own view of a loaded guild: their member, officer flag, and who they act as.
 * Only officers may act as someone else; `state.currentMemberId` is kept for them when valid.
 */
function withViewer(state) {
  const me = state.members.find((m) => m.discordId && m.discordId === remote.discordId)
  remote.memberId = me?.id ?? null
  remote.officer = Boolean(me?.officer)
  const keepsActingAs = remote.officer && state.members.some((m) => m.id === state.currentMemberId)
  return {
    ...state,
    currentMemberId: keepsActingAs ? state.currentMemberId : (me?.id ?? state.currentMemberId),
  }
}

/** Open an online guild the player belongs to. */
export async function openGuild(guildId) {
  const rows = await fetchGuild(supabase, guildId, sinceWeek())
  const week = app.data?.currentWeek ?? mondayOf(todayIso(rows.guilds[0].timezone))
  // Start as yourself, not whoever you were acting as in another guild.
  const state = withViewer(rowsToState(rows, { currentWeek: week, currentMemberId: '' }))
  shadow = stateToRows(state, guildId)
  remote.guildId = guildId
  remote.status = 'saved'
  storeGuildId(guildId)
  app.data = state
  follow(guildId)
}

/** Stop using the online guild and go back to the guild saved in this browser, if any. */
export function closeGuild() {
  if (channel) supabase.removeChannel(channel)
  channel = null
  clearTimeout(reloadTimer)
  shadow = null
  const wasOnline = remote.guildId !== null
  Object.assign(remote, { guildId: null, memberId: null, officer: false, status: 'saved' })
  storeGuildId(null)
  if (wasOnline) app.data = loadState()
}

/**
 * Create an online guild from `state` (a new guild from setup, or the browser guild being moved
 * online). The member being acted as becomes the first officer, linked to this Discord account.
 * @returns {Promise<string>} the new guild's id
 */
export async function createOnlineGuild(state) {
  const me = memberById(state, state.currentMemberId)
  const guildId = await createGuild(
    supabase,
    {
      name: state.guild.name,
      timezone: state.guild.timezone,
      dayStartHour: state.guild.dayStartHour,
      slotsPerDay: state.guild.slotsPerDay,
      settings: state.settings,
      discordServerId: state.guild.discordServerId,
      officerRoleIds: state.guild.officerRoleIds,
    },
    { id: me.id, name: me.name, position: state.members.indexOf(me) },
  )
  const linked = {
    ...state,
    members: state.members.map((m) => {
      if (m.id === me.id) return { ...m, discordId: remote.discordId, officer: true }
      // A Discord account belongs to one player per guild.
      return m.discordId === remote.discordId ? { ...m, discordId: '' } : m
    }),
  }
  const created = rowsToState(await fetchGuild(supabase, guildId, '0001-01-01'), linked)
  try {
    await applyOps(supabase, diffRows(stateToRows(created, guildId), stateToRows(linked, guildId)))
  } finally {
    remote.guilds = await listGuilds(supabase)
    await openGuild(guildId)
  }
  return guildId
}

/** Send the rows that differ between the server and `state`. Writes run one batch at a time. */
export function pushChanges(state) {
  if (!remote.guildId || !shadow) return
  const guildId = remote.guildId
  const next = stateToRows(state, guildId)
  const ops = diffRows(shadow, next)
  if (!ops.length) return
  shadow = next
  pending += 1
  remote.status = 'saving'
  queue = queue.then(async () => {
    try {
      await applyOps(supabase, ops)
      if (pending === 1 && remote.status === 'saving') remote.status = 'saved'
    } catch (error) {
      remote.status = 'error'
      showToast(`Not saved: ${error.message}`)
      // Put back what the server really has, so the screen does not show a change that failed.
      if (remote.guildId === guildId) scheduleReload(0)
    } finally {
      pending -= 1
    }
  })
}

function follow(guildId) {
  if (channel) supabase.removeChannel(channel)
  channel = TABLES.reduce(
    (ch, table) =>
      ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `${table === 'guilds' ? 'id' : 'guild_id'}=eq.${guildId}`,
        },
        () => scheduleReload(),
      ),
    supabase.channel(`guild-${guildId}`),
  )
  channel.subscribe()
}

function scheduleReload(delay = RELOAD_DEBOUNCE_MS) {
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(reload, delay)
}

/**
 * Fetch the guild and show it, unless our own writes are still in flight or the player changed
 * something meanwhile (then try again shortly, so the fresh copy includes those writes).
 */
async function reload() {
  const guildId = remote.guildId
  if (!guildId) return
  if (pending) return scheduleReload()
  const startedWith = app.data
  let rows
  try {
    rows = await fetchGuild(supabase, guildId, sinceWeek())
  } catch (error) {
    if (remote.guildId !== guildId) return
    if (error.code === 'PGRST116') {
      showToast('You are no longer a member of that guild.')
      remote.guilds = remote.guilds.filter((g) => g.id !== guildId)
      closeGuild()
      return
    }
    // Probably offline: keep trying, and show the server's copy once it answers.
    remote.status = 'error'
    return scheduleReload(RETRY_MS)
  }
  if (remote.guildId !== guildId) return
  if (pending || app.data !== startedWith) return scheduleReload()

  const { currentWeek, currentMemberId } = app.data
  let state
  try {
    state = withViewer(rowsToState(rows, { currentWeek, currentMemberId }))
  } catch {
    remote.status = 'error'
    showToast('The guild’s saved data could not be read. Reload the page to try again.')
    return
  }
  const fresh = stateToRows(state, guildId)
  shadow = fresh
  remote.status = 'saved'
  const changed = diffRows(stateToRows(app.data, guildId), fresh).length > 0
  if (changed || state.currentMemberId !== currentMemberId) app.data = state
}
