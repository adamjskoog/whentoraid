import { tick } from 'svelte'
import { app } from '../app.svelte.js'
import { CHECKIN_HISTORY_WEEKS, setCurrentWeek } from '../model.js'
import { DEFAULT_RAID_ID, setCurrentRaid } from '../raids.js'
import { parseHash } from '../route.js'
import { backupJson, loadState, parseState } from '../storage.js'
import { downloadText } from '../download.js'
import { addDays, mondayOf, todayIso } from '../time.js'
import { showToast } from '../toast.svelte.js'
import { applyOps, createGuildWithRows, fetchGuild, listGuilds, myDiscordId } from './api.js'
import { isLocalBackend, supabase } from './client.js'
import { diffRows, mergeRows, newGuildPayload, rowsToState, stateToRows, TABLES } from './rows.js'

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
const PAGE_LOCK_PREFIX = 'whentoraid-page:'
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
/** Last confirmed server rows, distinct from the optimistic queue's shadow. */
let committed = null
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
let draftBase = null
/** Where the offered draft is stored: this page's own key, or a closed page's key it took over. */
let unsavedDraftKey = null
let reapplyRequested = null

/**
 * Each page (a tab; a reload is a new page) keeps its recovery draft under its own key, so one tab
 * finishing a save never deletes another tab's draft. A page holds a Web Lock for its lifetime;
 * drafts of pages that still hold theirs are left to them, and only drafts of closed pages are
 * offered for recovery.
 */
const PAGE_ID = crypto.randomUUID()
try {
  navigator.locks?.request(`${PAGE_LOCK_PREFIX}${PAGE_ID}`, () => new Promise(() => {})).catch(() => {})
} catch {
  // Without Web Locks, every other page's draft counts as left behind by a closed page.
}

function draftPrefix(userId = sessionUserId) {
  return `${DRAFT_KEY_PREFIX}${userId}:`
}

function draftKey(userId = sessionUserId, guildId = remote.guildId) {
  return userId && guildId ? `${draftPrefix(userId)}${guildId}:${PAGE_ID}` : null
}

/** Ids of pages that are still open, or null when the browser cannot tell. */
async function openPageIds() {
  try {
    const { held = [] } = await navigator.locks.query()
    return new Set(
      held
        .map((lock) => lock.name)
        .filter((name) => name?.startsWith(PAGE_LOCK_PREFIX))
        .map((name) => name.slice(PAGE_LOCK_PREFIX.length)),
    )
  } catch {
    return null
  }
}

/** Every stored draft of `userId`'s that no other open page is handling. */
async function leftDrafts(userId) {
  if (!userId) return []
  const open = await openPageIds()
  const prefix = draftPrefix(userId)
  const drafts = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      // Keys before per-page drafts had no page id: `prefix + guildId`.
      const [guildId, pageId = null] = key.slice(prefix.length).split(':')
      if (pageId && pageId !== PAGE_ID && open?.has(pageId)) continue
      const stored = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (stored?.userId !== userId || stored?.guildId !== guildId) continue
      drafts.push({ key, stored })
    }
  } catch {
    // Storage unavailable: nothing can be recovered from it.
  }
  return drafts
}

/** The newest usable draft for the open guild, moving one from the older session-storage format. */
async function readDraft() {
  const key = draftKey()
  if (!key) return null
  try {
    const legacy = JSON.parse(sessionStorage.getItem(LEGACY_DRAFT_KEY) ?? 'null')
    if (legacy?.userId === sessionUserId && legacy?.guildId === remote.guildId) {
      localStorage.setItem(key, JSON.stringify(legacy))
      sessionStorage.removeItem(LEGACY_DRAFT_KEY)
    }
  } catch {
    // Keep any in-memory draft available when browser storage is unavailable.
  }
  const usable = (await leftDrafts(sessionUserId))
    .filter(({ stored }) => stored.guildId === remote.guildId)
    .sort((a, b) => (b.stored.savedAt ?? 0) - (a.stored.savedAt ?? 0))
  return usable[0] ?? null
}

async function showDraftForOpenGuild() {
  const guildId = remote.guildId
  const userId = sessionUserId
  const found = await readDraft()
  if (remote.guildId !== guildId || sessionUserId !== userId) return
  unsavedDraft = found?.stored ?? null
  unsavedDraftKey = found?.key ?? null
  remote.hasUnsavedDraft = Boolean(unsavedDraft)
  if (remote.hasUnsavedDraft) remote.status = 'error'
}

function preserveDraft(needsReview = true) {
  if (!sessionUserId || !remote.guildId || !app.data) return
  unsavedDraft = {
    userId: sessionUserId,
    guildId: remote.guildId,
    savedAt: Date.now(),
    state: $state.snapshot(app.data),
    base: draftBase ?? committed,
  }
  try {
    localStorage.setItem(draftKey(), JSON.stringify(unsavedDraft))
    // A closed page's draft that this page took over now lives under this page's key.
    if (unsavedDraftKey && unsavedDraftKey !== draftKey()) localStorage.removeItem(unsavedDraftKey)
    unsavedDraftKey = draftKey()
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

/** Forget this page's draft, and a closed page's draft it took over; never another tab's. */
function clearDraft() {
  const keys = [draftKey(), unsavedDraftKey]
  unsavedDraft = null
  draftBase = null
  unsavedDraftKey = null
  remote.hasUnsavedDraft = false
  reapplyRequested = null
  try {
    for (const key of keys) if (key) localStorage.removeItem(key)
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
  if (!parseState(JSON.stringify(unsavedDraft.state))) {
    showToast('This edit cannot be read by this version of WhenToRaid. Download it instead.')
    return
  }
  if (!unsavedDraft.base) {
    showToast(
      'This older draft has no change history. Download it and copy your edits into the latest guild.',
    )
    return
  }
  let recovered
  try {
    recovered = mergeRows(unsavedDraft.base, stateToRows(unsavedDraft.state, remote.guildId), shadow, {
      reviewed: true,
    })
  } catch {
    showToast('This edit removes a player whose records changed. Download it and review those changes first.')
    return
  }
  if (!diffRows(shadow, recovered).length) {
    dismissUnsavedDraft()
    return
  }
  reapplyRequested = draftKey()
  draftBase = shadow
  app.data = withViewer(rowsToState(recovered, app.data))
}

export function dismissUnsavedDraft() {
  clearDraft()
  if (!remote.guildId) return
  remote.status = 'saved'
  void showDraftForOpenGuild()
}

async function finishPendingSaves() {
  return flushOnlineChanges()
}

/** Wait for all edits to commit before leaving or starting an external side effect. */
export async function flushOnlineChanges() {
  // Let App's save effect enqueue a just-made edit before checking the queue.
  await tick()
  let waiting
  do {
    waiting = queue
    await waiting
    await tick()
  } while (waiting !== queue)
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

/** A roster link opened before signing in, kept for the sign-in round trip. */
const PENDING_LINK_KEY = 'whentoraid-pending-link'
/** An abandoned sign-in must not send a later one to an old link. */
const PENDING_LINK_MS = 10 * 60_000

function takePendingLink() {
  try {
    const pending = JSON.parse(sessionStorage.getItem(PENDING_LINK_KEY) ?? 'null')
    sessionStorage.removeItem(PENDING_LINK_KEY)
    return pending && Date.now() - pending.at < PENDING_LINK_MS ? pending : null
  } catch {
    return null
  }
}

/**
 * A guild named by a shared roster link (`?guild=`), once; the parameter is removed after reading.
 * After signing in, the link saved before the redirect is used, and its page is restored.
 */
function takeRequestedGuild() {
  const url = new URL(location.href)
  const pending = takePendingLink()
  let guildId = url.searchParams.get('guild')
  let hash = location.hash
  if (guildId !== null) {
    url.searchParams.delete('guild')
    history.replaceState(history.state, '', url)
  } else if (pending) {
    guildId = pending.guild
    hash = pending.hash
  }
  return /^[0-9a-f-]{36}$/i.test(guildId ?? '') ? { guildId, hash } : null
}

/** Open the published roster a link named, in the guild that just loaded. */
function showLinkedRoster(hash) {
  const route = parseHash(hash)
  if (!route.published || !route.week || !app.data) return
  app.data = setCurrentRaid(setCurrentWeek(app.data, route.week), route.raid ?? DEFAULT_RAID_ID)
  app.plannerIntent = 'published'
  app.view = 'planner'
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
    const requested = takeRequestedGuild()
    const member = (id) => guilds.some((g) => g.id === id)
    if (requested && !member(requested.guildId))
      showToast('That roster link is for a guild you have not joined. Ask an officer for an invite.')
    const chosen = requested && member(requested.guildId) ? requested.guildId : saved
    if (chosen && member(chosen)) {
      await openGuild(chosen, generation)
      if (chosen === requested?.guildId && generation === sessionGeneration) showLinkedRoster(requested.hash)
    } else if (saved) storeGuildId(null)
  } catch (error) {
    if (generation === sessionGeneration) showToast(error.message)
  } finally {
    if (generation === sessionGeneration) remote.ready = true
  }
}

export async function signIn() {
  const redirectTo = `${location.origin}${location.pathname}`
  // The sign-in redirect returns to the bare address, so a roster link is carried across it.
  const guild = /[?&]guild=([0-9a-f-]{36})(?:&|$)/i.exec(location.search)?.[1]
  if (guild) {
    try {
      sessionStorage.setItem(PENDING_LINK_KEY, JSON.stringify({ guild, hash: location.hash, at: Date.now() }))
    } catch {
      // Without storage the link opens the player's usual guild instead.
    }
  }
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

/**
 * Sign out. Drafts left by closed pages hold whole guilds, so they are not left on a shared computer
 * by accident: while any exist, signing out refuses (error code `UNSAVED_DRAFTS`), and
 * `{ discardDrafts: true }` deletes them and signs out.
 */
export async function signOut({ discardDrafts = false } = {}) {
  await finishPendingSaves()
  const drafts = await leftDrafts(sessionUserId)
  if (drafts.length && !discardDrafts) {
    // Name only guilds the player can still open; opening one offers its drafts one at a time.
    const openable = remote.guilds
      .filter((g) => drafts.some(({ stored }) => stored.guildId === g.id))
      .map((g) => `“${g.name}”`)
    const advice = openable.length
      ? `Open ${openable.join(', ')} to download or reapply them, or sign out again to discard them.`
      : 'They belong to guilds you can no longer open. Sign out again to discard them.'
    throw Object.assign(new Error(`Edits that were never saved are stored in this browser. ${advice}`), {
      code: 'UNSAVED_DRAFTS',
    })
  }
  const { error } = await supabase.auth.signOut()
  if (error) throw error
  try {
    for (const { key } of drafts) localStorage.removeItem(key)
  } catch {
    // Storage unavailable: nothing was stored there either.
  }
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
  committed = shadow
  revisions[guildId] = rows.revision
  saveEpochs[guildId] = (saveEpochs[guildId] ?? 0) + 1
  delete blockedGuilds[guildId]
  remote.guildId = guildId
  remote.status = 'saved'
  storeGuildId(guildId)
  app.data = state
  follow(guildId)
  await showDraftForOpenGuild()
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
  committed = null
  const wasOnline = remote.guildId !== null
  Object.assign(remote, { guildId: null, memberId: null, officer: false, status: 'saved' })
  remote.hasUnsavedDraft = false
  unsavedDraft = null
  draftBase = null
  unsavedDraftKey = null
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
  const { guild, me, rows } = newGuildPayload(state, remote.discordId)
  const guildId = await createGuildWithRows(supabase, guild, me, rows)
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
  const before = shadow
  const ops = diffRows(shadow, next)
  if (!ops.length) return
  if (!pending) draftBase = before
  // Keep a copy that survives closing the tab mid-save; storage may be unavailable.
  preserveDraft(false)
  shadow = next
  pending += 1
  remote.status = 'saving'
  queue = queue.then(async () => {
    try {
      if (blockedGuilds[guildId] || saveEpochs[guildId] !== epoch || sessionUserId !== ownerUserId) return
      for (let attempt = 0; ; attempt += 1) {
        const merged = mergeRows(before, next, committed)
        try {
          const revision = await applyOps(supabase, guildId, revisions[guildId], diffRows(committed, merged))
          if (saveEpochs[guildId] !== epoch || sessionUserId !== ownerUserId) return
          revisions[guildId] = revision
          committed = merged
          break
        } catch (error) {
          if (error.code !== '40001' || attempt >= 2) throw error
          const latest = await fetchGuild(supabase, guildId, sinceWeek())
          if (saveEpochs[guildId] !== epoch || sessionUserId !== ownerUserId) return
          committed = stateToRows(rowsToState(latest, app.data), guildId)
          revisions[guildId] = latest.revision
        }
      }
      if (remote.guildId === guildId && pending === 1) {
        // Bring independent remote changes into view, retaining edits made during this save.
        const visible = mergeRows(next, stateToRows(app.data, guildId), committed)
        shadow = committed
        if (diffRows(stateToRows(app.data, guildId), visible).length) {
          app.data = withViewer(rowsToState(visible, app.data))
        }
        const reapplied = reapplyRequested !== null
        clearDraft()
        if (reapplied) void showDraftForOpenGuild()
      }
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
  committed = fresh
  revisions[guildId] = rows.revision
  delete blockedGuilds[guildId]
  remote.status = remote.hasUnsavedDraft ? 'error' : 'saved'
  const changed = diffRows(stateToRows(app.data, guildId), fresh).length > 0
  if (changed || state.currentMemberId !== currentMemberId) app.data = state
}
