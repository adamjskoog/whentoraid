import { afterEach, expect, test, vi } from 'vitest'
import { waitFor } from '@testing-library/svelte'
import { createSeedState } from '../seed.js'
import { stateToRows } from './rows.js'

const mocked = vi.hoisted(() => ({
  onAuthStateChange: null,
  discordId: null,
  rows: null,
  fetchError: false,
  fetchAttempts: 0,
  applyError: false,
  applyGate: null,
  applied: 0,
  signOutCalls: 0,
}))

vi.mock('./client.js', () => ({
  isLocalBackend: false,
  supabase: {
    auth: {
      onAuthStateChange(callback) {
        mocked.onAuthStateChange = callback
        return { data: { subscription: { unsubscribe() {} } } }
      },
      async signOut() {
        mocked.signOutCalls += 1
        return { error: null }
      },
    },
    channel() {
      return {
        on() {
          return this
        },
        subscribe() {},
      }
    },
    removeChannel() {},
  },
}))

vi.mock('./api.js', () => ({
  myDiscordId: async () => mocked.discordId,
  listGuilds: async () => [{ id: 'guild-test', name: 'Test guild' }],
  fetchGuild: async () => {
    mocked.fetchAttempts += 1
    if (mocked.fetchError) throw new Error('Offline')
    return mocked.rows
  },
  applyOps: async () => {
    if (mocked.applyGate) await mocked.applyGate
    mocked.applied += 1
    if (mocked.applyError) throw new Error('Rejected save')
    return 1
  },
  createGuildWithRows: async () => 'guild-test',
}))

import { app } from '../app.svelte.js'
import {
  dismissUnsavedDraft,
  initRemote,
  pushChanges,
  reapplyUnsavedDraft,
  remote,
  signOut,
} from './sync.svelte.js'

/** The stored recovery draft of `userId` for `guildId`, from any page, or null. */
function storedDraft(userId, guildId) {
  const prefix = `whentoraid-unsaved-online-draft:${userId}:${guildId}:`
  const key = Object.keys(localStorage).find((k) => k.startsWith(prefix))
  return key ? localStorage.getItem(key) : null
}

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

test('switching directly between signed-in identities replaces the guild viewer', async () => {
  const guildId = 'guild-test'
  const state = createSeedState()
  const first = state.members[0]
  const second = state.members[1]
  const members = state.members.map((member) => ({
    ...member,
    discordId: member.id === first.id ? 'discord-a' : member.id === second.id ? 'discord-b' : '',
    officer: false,
  }))
  mocked.rows = { ...stateToRows({ ...state, members }, guildId), revision: 0 }
  localStorage.setItem('whentoraid-online-guild', guildId)
  const stop = initRemote()
  mocked.discordId = 'discord-a'
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'auth-a' } })
  await waitFor(() => expect(remote.memberId).toBe(first.id))

  mocked.discordId = 'discord-b'
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'auth-b' } })
  await waitFor(() => expect(remote.memberId).toBe(second.id))
  expect(remote.discordId).toBe('discord-b')
  expect(app.data.currentMemberId).toBe(second.id)

  mocked.applyError = true
  const edited = { ...app.data, guild: { ...app.data.guild, name: 'Unsaved name' } }
  app.data = edited
  pushChanges(edited)
  await waitFor(() => expect(remote.hasUnsavedDraft).toBe(true))
  expect(JSON.parse(storedDraft('auth-b', guildId)).state.guild.name).toBe('Unsaved name')
  await expect(signOut()).rejects.toThrow(/not saved/)
  expect(mocked.signOutCalls).toBe(0)

  await waitFor(() => expect(app.data.guild.name).toBe(state.guild.name))
  mocked.applyError = false
  let finishSave
  mocked.applyGate = new Promise((resolve) => {
    finishSave = resolve
  })
  reapplyUnsavedDraft()
  pushChanges(app.data)
  expect(storedDraft('auth-b', guildId)).toBeTruthy()

  mocked.discordId = 'discord-a'
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'auth-a' } })
  await waitFor(() => expect(remote.memberId).toBe(first.id))
  finishSave()
  await waitFor(() => expect(mocked.applied).toBe(2))
  expect(storedDraft('auth-b', guildId)).toBeTruthy()
  expect(remote.hasUnsavedDraft).toBe(false)

  mocked.onAuthStateChange('SIGNED_OUT', null)
  await waitFor(() => expect(remote.signedIn).toBe(false))
  localStorage.setItem('whentoraid-online-guild', guildId)
  mocked.fetchError = true
  const attempts = mocked.fetchAttempts
  mocked.discordId = 'discord-b'
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'auth-b' } })
  await waitFor(() => expect(mocked.fetchAttempts).toBeGreaterThan(attempts))
  expect(localStorage.getItem('whentoraid-online-guild')).toBe(guildId)
  stop()
})

test('an edit is still saved online when browser storage refuses the recovery copy', async () => {
  const guildId = 'guild-test'
  const state = createSeedState()
  const members = state.members.map((member, index) => ({
    ...member,
    discordId: index === 0 ? 'discord-c' : '',
    officer: index === 0,
  }))
  mocked.rows = { ...stateToRows({ ...state, members }, guildId), revision: 0 }
  mocked.fetchError = false
  mocked.applyError = false
  mocked.applyGate = null
  localStorage.setItem('whentoraid-online-guild', guildId)
  const stop = initRemote()
  mocked.discordId = 'discord-c'
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'auth-c' } })
  await waitFor(() => expect(remote.guildId).toBe(guildId))

  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked')
  })
  const applied = mocked.applied
  const edited = { ...app.data, guild: { ...app.data.guild, name: 'Saved without storage' } }
  app.data = edited
  pushChanges(edited)
  await waitFor(() => expect(mocked.applied).toBe(applied + 1))
  await waitFor(() => expect(remote.status).toBe('saved'))
  expect(remote.hasUnsavedDraft).toBe(false)
  setItem.mockRestore()
  stop()
})

test('drafts belong to their page: open tabs keep theirs, closed tabs offer theirs, sign-out asks first', async () => {
  const guildId = 'guild-test'
  const state = createSeedState()
  const members = state.members.map((member, index) => ({
    ...member,
    discordId: index === 0 ? 'discord-d' : '',
    officer: index === 0,
  }))
  mocked.rows = { ...stateToRows({ ...state, members }, guildId), revision: 0 }
  Object.assign(mocked, { fetchError: false, applyError: false, applyGate: null, signOutCalls: 0 })
  // Another tab is still open: it holds its page lock.
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { query: async () => ({ held: [{ name: 'whentoraid-page:open-page' }] }) },
  })
  const prefix = 'whentoraid-unsaved-online-draft:auth-d:'
  const seeded = { ...state, members, currentMemberId: members[0].id }
  const draftOf = (forGuild, name, savedAt) =>
    JSON.stringify({
      userId: 'auth-d',
      guildId: forGuild,
      savedAt,
      state: { ...seeded, guild: { ...seeded.guild, name } },
    })
  localStorage.setItem(`${prefix}${guildId}:open-page`, draftOf(guildId, 'Open tab edit', 2))
  localStorage.setItem(`${prefix}${guildId}:closed-page`, draftOf(guildId, 'Closed tab edit', 1))
  localStorage.setItem(`${prefix}${guildId}:older-page`, draftOf(guildId, 'Older closed tab edit', 0))
  localStorage.setItem('whentoraid-online-guild', guildId)

  const stop = initRemote()
  mocked.discordId = 'discord-d'
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'auth-d' } })
  await waitFor(() => expect(remote.hasUnsavedDraft).toBe(true))
  dismissUnsavedDraft()
  expect(localStorage.getItem(`${prefix}${guildId}:closed-page`)).toBeNull()
  // The next draft a closed tab left is offered in turn.
  await waitFor(() => expect(remote.hasUnsavedDraft).toBe(true))
  dismissUnsavedDraft()
  expect(localStorage.getItem(`${prefix}${guildId}:older-page`)).toBeNull()
  await waitFor(() => expect(remote.status).toBe('saved'))
  expect(remote.hasUnsavedDraft).toBe(false)

  const applied = mocked.applied
  const edited = { ...app.data, guild: { ...app.data.guild, name: 'Saved here' } }
  app.data = edited
  pushChanges(edited)
  await waitFor(() => expect(mocked.applied).toBe(applied + 1))
  await waitFor(() => expect(remote.status).toBe('saved'))
  expect(localStorage.getItem(`${prefix}${guildId}:open-page`)).toBeTruthy()

  localStorage.setItem(`${prefix}guild-other:closed-page`, draftOf('guild-other', 'Elsewhere', 3))
  await expect(signOut()).rejects.toMatchObject({
    code: 'UNSAVED_DRAFTS',
    message: expect.stringMatching(/guilds you can no longer open/),
  })
  expect(mocked.signOutCalls).toBe(0)
  await signOut({ discardDrafts: true })
  expect(mocked.signOutCalls).toBe(1)
  expect(localStorage.getItem(`${prefix}guild-other:closed-page`)).toBeNull()
  expect(localStorage.getItem(`${prefix}${guildId}:open-page`)).toBeTruthy()

  delete navigator.locks
  stop()
})
