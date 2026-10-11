import { tick } from 'svelte'
import { app } from '../app.svelte.js'
import { CHECKIN_HISTORY_WEEKS, memberById } from '../model.js'
import { backupJson, loadState, parseState } from '../storage.js'
import { downloadText } from '../download.js'
import { addDays, mondayOf, todayIso } from '../time.js'
import { showToast } from '../toast.svelte.js'
import { applyOps, createGuildWithRows, fetchGuild, listGuilds, myDiscordId } from './api.js'
import { isLocalBackend, supabase } from './client.js'
import { diffRows, rowsToState, stateToRows, TABLES } from './rows.js'

/**
 * Online guilds. While a guild is open, `app.data` still holds the whole guild and every change
 * still goes through the pure model functions; App passes each new state to `pushChanges`, which
 * sends only the rows that changed. Realtime tells us when someone else changed something, and we
 * reload the guild. The server RPC authorizes every write; `canManage` only keeps the UI from
 * offering what the server would refuse.
 */

const ACTIVE_GUILD_KEY = 'whentoraid-online-guild'
const LEGACY_DRAFT_KEY = 'whentoraid-unsaved-online-draft'
const DRAFT_KEY_PREFIX = 'whentoraid-unsaved-online-draft:'
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
  hasUnsavedDraft: false,
})

/** Rows the server is believed to hold for the open guild; changes are diffed against it. */
let shadow = null
let queue = Promise.resolve()
let pending = 0
const revisions = Object.create(null)
const blockedGuilds = Object.create(null)
const saveEpochs = Object.create(null)
let channel = null
let reloadTimer
let sessionUserId = null
let sessionGeneration = 0
let unsavedDraft = null
let reapplyRequested = null

function draftKey(userId = sessionUserId, guildId = remote.guildId) {
  return userId && guildId ? `${DRAFT_KEY_PREFIX}${userId}:${guildId}` : null
}

function readDraft() {
  const key = draftKey()
  if (!key) return null
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (
      stored?.userId === sessionUserId &&
      stored?.guildId === remote.guildId &&
      parseState(JSON.stringify(stored.state))
    )
      return stored
    // Preserve drafts created by the previous session-storage implementation.
    const legacy = JSON.parse(sessionStorage.getItem(LEGACY_DRAFT_KEY) ?? 'null')
    if (
      legacy?.userId === sessionUserId &&
      legacy?.guildId === remote.guildId &&
      parseState(JSON.stringify(legacy.state))
    ) {
      localStorage.setItem(key, JSON.stringify(legacy))
      sessionStorage.removeItem(LEGACY_DRAFT_KEY)
      return legacy
    }
  } catch {
    // Keep any in-memory draft available when browser storage is unavailable.
  }
  return null
}

function showDraftForOpenGuild() {
  unsavedDraft = readDraft()
  remote.hasUnsavedDraft = Boolean(
    unsavedDraft && unsavedDraft.userId === sessionUserId && unsavedDraft.guildId === remote.guildId,
  )
  if (remote.hasUnsavedDraft) remote.status = 'error'
}

function preserveDraft(needsReview = true) {
  if (!sessionUserId || !remote.guildId || !app.data) return
  unsavedDraft = {
    userId: sessionUserId,
    guildId: remote.guildId,
    state: $state.snapshot(app.data),
  }
  try {
    localStorage.setItem(draftKey(), JSON.stringify(unsavedDraft))
  } catch {
    // Before a save, the in-memory copy is enough: the save itself still has to go out.
    if (!needsReview) return false
    remote.hasUnsavedDraft = true
    remote.status = 'error'
    showToast('Browser storage is unavailable. Download your unsaved edit before closing this tab.')
    return false
  }
  remote.hasUnsavedDraft = needsReview
  if (needsReview) remote.status = 'error'
  return true
}

function clearDraft() {
  const key = draftKey()
  unsavedDraft = null
  remote.hasUnsavedDraft = false
  reapplyRequested = null
  try {
    if (key) localStorage.removeItem(key)
    sessionStorage.removeItem(LEGACY_DRAFT_KEY)
  } catch {
    // Nothing else needs to be done when session storage is unavailable.
  }
}

export function downloadUnsavedDraft() {
  if (!remote.hasUnsavedDraft || !unsavedDraft) return
  downloadText(
    `whentoraid-unsaved-${remote.guildId}.json`,
    backupJson(unsavedDraft.state),
    'application/json',
  )
}

export function reapplyUnsavedDraft() {
  if (!remote.hasUnsavedDraft || !unsavedDraft || pending) return
  if (blockedGuilds[remote.guildId]) {
    showToast('Wait for the latest online guild to load before reapplying your edit.')
    return
  }
  if (!diffRows(shadow, stateToRows(unsavedDraft.state, remote.guildId)).length) {
    dismissUnsavedDraft()
    return
  }
  reapplyRequested = draftKey()
  app.data = unsavedDraft.state
}

export function dismissUnsavedDraft() {
  clearDraft()
  if (remote.guildId) remote.status = 'saved'
}

async function finishPendingSaves() {
  // Let App's save effect enqueue a just-made edit before checking the queue.
  await tick()
  await queue
  if (remote.hasUnsavedDraft) {
    throw new Error('An online edit was not saved. Download or reapply it before leaving this guild.')
  }
}

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
    const generation = ++sessionGeneration
    setTimeout(() => onSession(session, generation), 0)
  })
  return () => data.subscription.unsubscribe()
}

async function onSession(session, generation) {
  if (generation !== sessionGeneration) return
  const userId = session?.user?.id ?? null
  // Token refreshes do not change the loaded guild. A different user always does.
  if (remote.ready && userId === sessionUserId) return
  const saved = storedGuildId()
  if (remote.guildId && pending) preserveDraft()
  closeGuild(Boolean(userId))
  sessionUserId = userId
  remote.signedIn = Boolean(userId)
  Object.assign(remote, { discordId: null, guilds: [], ready: !userId })
  if (!userId) return
  cleanAuthParams()
  try {
    const discordId = await myDiscordId(supabase)
    if (generation !== sessionGeneration) return
    remote.discordId = discordId
    const guilds = await listGuilds(supabase)
    if (generation !== sessionGeneration) return
    remote.guilds = guilds
    if (saved && guilds.some((g) => g.id === saved)) await openGuild(saved, generation)
    else if (saved) storeGuildId(null)
  } catch (error) {
    if (generation === sessionGeneration) showToast(error.message)
  } finally {
    if (generation === sessionGeneration) remote.ready = true
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
  await finishPendingSaves()
  const { error } = await supabase.auth.signOut()
  if (error) throw error
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
export async function openGuild(guildId, expectedGeneration = sessionGeneration) {
  if (remote.guildId) await finishPendingSaves()
  const previousState = app.data
  const rows = await fetchGuild(supabase, guildId, sinceWeek())
  if (expectedGeneration !== sessionGeneration) return
  if (remote.guildId) {
    await finishPendingSaves()
    if (app.data !== previousState) {
      throw new Error('Your current guild changed while switching. Try again after it saves.')
    }
  }
  const week = app.data?.currentWeek ?? mondayOf(todayIso(rows.guilds[0].timezone))
  // Start as yourself, not whoever you were acting as in another guild.
  const state = withViewer(rowsToState(rows, { currentWeek: week, currentMemberId: '' }))
  shadow = stateToRows(state, guildId)
  revisions[guildId] = rows.revision
  saveEpochs[guildId] = (saveEpochs[guildId] ?? 0) + 1
  delete blockedGuilds[guildId]
  remote.guildId = guildId
  remote.status = 'saved'
  storeGuildId(guildId)
  app.data = state
  showDraftForOpenGuild()
  follow(guildId)
}

export async function leaveGuild() {
  await finishPendingSaves()
  closeGuild()
}

/** Stop using the online guild and go back to the guild saved in this browser, if any. */
export function closeGuild(preserveStoredGuild = false) {
  if (remote.guildId) saveEpochs[remote.guildId] = (saveEpochs[remote.guildId] ?? 0) + 1
  if (channel) supabase.removeChannel(channel)
  channel = null
  clearTimeout(reloadTimer)
  shadow = null
  const wasOnline = remote.guildId !== null
  Object.assign(remote, { guildId: null, memberId: null, officer: false, status: 'saved' })
  remote.hasUnsavedDraft = false
  unsavedDraft = null
  reapplyRequested = null
  if (!preserveStoredGuild) storeGuildId(null)
  if (wasOnline) app.data = loadState()
}

/**
 * Create an online guild from `state` (a new guild from setup, or the browser guild being moved
 * online). The member being acted as becomes the first officer, linked to this Discord account.
 * @returns {Promise<string>} the new guild's id
 */
export async function createOnlineGuild(state) {
  const me = memberById(state, state.currentMemberId)
  const linked = {
    ...state,
    members: state.members.map((m) => {
      if (m.id === me.id) return { ...m, discordId: remote.discordId, officer: true }
      // A Discord account belongs to one player per guild.
      return m.discordId === remote.discordId ? { ...m, discordId: '' } : m
    }),
  }
  const guildId = await createGuildWithRows(
    supabase,
    {
      name: state.guild.name,
      timezone: state.guild.timezone,
      dayStartHour: state.guild.dayStartHour,
      slotsPerDay: state.guild.slotsPerDay,
      settings: { ...state.settings, ...(state.demoYear ? { demoYear: state.demoYear } : {}) },
      discordServerId: state.guild.discordServerId,
      officerRoleIds: state.guild.officerRoleIds,
    },
    { id: me.id, name: me.name, position: state.members.indexOf(me) },
    stateToRows(linked, '00000000-0000-0000-0000-000000000000'),
  )
  await openGuild(guildId)
  remote.guilds = await listGuilds(supabase)
  return guildId
}

/** Send the rows that differ between the server and `state`. Writes run one batch at a time. */
export function pushChanges(state) {
  if (!remote.guildId || !shadow) return
  if (remote.hasUnsavedDraft && reapplyRequested !== draftKey()) return
  if (blockedGuilds[remote.guildId]) {
    // Edits made while the latest server copy is loading still belong in the recovery draft.
    preserveDraft()
    return
  }
  const guildId = remote.guildId
  const epoch = saveEpochs[guildId]
  const ownerUserId = sessionUserId
  const next = stateToRows(state, guildId)
  const ops = diffRows(shadow, next)
  if (!ops.length) return
  // Keep a copy that survives closing the tab mid-save; storage may be unavailable.
  preserveDraft(false)
  shadow = next
  pending += 1
  remote.status = 'saving'
  queue = queue.then(async () => {
    try {
      if (blockedGuilds[guildId] || saveEpochs[guildId] !== epoch || sessionUserId !== ownerUserId) return
      const revision = await applyOps(supabase, guildId, revisions[guildId], ops)
      if (saveEpochs[guildId] !== epoch || sessionUserId !== ownerUserId) return
      revisions[guildId] = revision
      if (remote.guildId === guildId && pending === 1) clearDraft()
      if (remote.guildId === guildId && pending === 1 && remote.status === 'saving') {
        remote.status = 'saved'
      }
    } catch (error) {
      if (saveEpochs[guildId] !== epoch || sessionUserId !== ownerUserId) return
      blockedGuilds[guildId] = true
      saveEpochs[guildId] += 1
      if (remote.guildId === guildId) {
        preserveDraft()
        remote.status = 'error'
        showToast(`Not saved: ${error.message}`)
        // Put back what the server really has; later queued edits depend on this failed batch.
        scheduleReload(0)
      }
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
    state = withViewer(
      rowsToState(rows, { currentWeek, currentMemberId, currentRaidId: app.data?.currentRaidId }),
    )
  } catch {
    remote.status = 'error'
    showToast('The guild’s saved data could not be read. Reload the page to try again.')
    return
  }
  const fresh = stateToRows(state, guildId)
  shadow = fresh
  revisions[guildId] = rows.revision
  delete blockedGuilds[guildId]
  remote.status = remote.hasUnsavedDraft ? 'error' : 'saved'
  const changed = diffRows(stateToRows(app.data, guildId), fresh).length > 0
  if (changed || state.currentMemberId !== currentMemberId) app.data = state
}
