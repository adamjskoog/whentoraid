import { describe, expect, test, vi } from 'vitest'
import {
  canPost,
  checkChannelInServer,
  handleConnect,
  listChannels,
  validRedirectUri,
} from '../../supabase/functions/_shared/discord-connect.js'
import { connectRedirectUri, finishDiscordConnect, startDiscordConnect } from './discord-connect.js'

const SERVER = '700000000000000001'
const BOT = '700000000000000002'
const OFFICERS = '700000000000000003'
const BOT_ROLE = '700000000000000004'
const VIEW = 1 << 10
const SEND = 1 << 11
const GUILD_ID = '11111111-2222-3333-4444-555555555555'
const REDIRECT = 'https://whentoraid.github.io/discord-connect.html'

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status })

/** A fake Discord API: each path answers with a fixed body; anything else is a 404. */
function discordApi(routes) {
  return vi.fn(async (url, init) => {
    const path = String(url).replace('https://discord.com/api/v10', '')
    const route = routes[`${init?.method ?? 'GET'} ${path}`]
    return route === undefined ? jsonResponse({ message: 'Unknown' }, 404) : jsonResponse(route)
  })
}

const config = (overrides = {}) => ({
  applicationId: BOT,
  clientSecret: 'secret',
  botToken: 'token',
  appUrl: 'https://whentoraid.github.io/',
  rpc: vi.fn(async () => {}),
  linkedServer: vi.fn(async () => SERVER),
  ...overrides,
})

describe('the return address', () => {
  test('is the static page next to this app, or on a dev server on this computer', () => {
    const app = 'https://whentoraid.github.io/'
    expect(validRedirectUri(REDIRECT, app)).toBe(true)
    expect(validRedirectUri('http://localhost:5174/discord-connect.html', app)).toBe(true)
    expect(validRedirectUri('https://fork.example/discord-connect.html', app)).toBe(false)
    expect(validRedirectUri(REDIRECT, '')).toBe(false)
    expect(validRedirectUri('http://whentoraid.github.io/discord-connect.html', app)).toBe(false)
    expect(validRedirectUri('https://whentoraid.github.io/', app)).toBe(false)
    expect(validRedirectUri('https://whentoraid.github.io/discord-connect.html?x=1', app)).toBe(false)
    expect(validRedirectUri('not a url', app)).toBe(false)
  })

  test('is built from wherever the app is served', () => {
    expect(connectRedirectUri('https://whentoraid.github.io/?guild=x#/settings')).toBe(REDIRECT)
    expect(connectRedirectUri('https://example.com/raid/#/home')).toBe(
      'https://example.com/raid/discord-connect.html',
    )
  })
})

describe('bot channel permissions', () => {
  const roles = [
    { id: SERVER, permissions: String(VIEW | SEND) },
    { id: BOT_ROLE, permissions: '0' },
  ]
  const check = (overwrites, memberRoles = [BOT_ROLE], serverRoles = roles) =>
    canPost({
      serverId: SERVER,
      memberId: BOT,
      memberRoleIds: memberRoles,
      roles: serverRoles,
      channel: { permission_overwrites: overwrites },
    })

  test('a public channel inherits @everyone', () => {
    expect(check([])).toBe(true)
  })

  test('a private channel hides from the bot unless its role or the bot itself is allowed', () => {
    const hidden = { id: SERVER, type: 0, allow: '0', deny: String(VIEW) }
    expect(check([hidden])).toBe(false)
    expect(check([hidden, { id: BOT_ROLE, type: 0, allow: String(VIEW), deny: '0' }])).toBe(true)
    expect(check([hidden, { id: BOT, type: 1, allow: String(VIEW), deny: '0' }])).toBe(true)
  })

  test('a member overwrite beats a role overwrite, and Administrator ignores overwrites', () => {
    const roleAllows = { id: BOT_ROLE, type: 0, allow: String(VIEW | SEND), deny: '0' }
    const botDenied = { id: BOT, type: 1, allow: '0', deny: String(SEND) }
    expect(check([roleAllows, botDenied])).toBe(false)
    const admin = [...roles, { id: OFFICERS, permissions: String(1 << 3) }]
    expect(check([botDenied], [OFFICERS], admin)).toBe(true)
  })
})

describe('listing the connected server’s channels', () => {
  test('text channels in Discord order with their category, marked where the bot can post', async () => {
    const fetchFn = discordApi({
      'GET /users/@me': { id: BOT },
      [`GET /guilds/${SERVER}/members/${BOT}`]: { roles: [] },
      [`GET /guilds/${SERVER}/roles`]: [{ id: SERVER, permissions: String(VIEW | SEND) }],
      [`GET /guilds/${SERVER}/channels`]: [
        {
          id: '800000000000000004',
          type: 0,
          name: 'officers',
          position: 0,
          parent_id: '800000000000000009',
          permission_overwrites: [{ id: SERVER, type: 0, allow: '0', deny: String(VIEW) }],
        },
        { id: '800000000000000009', type: 4, name: 'Raiding', position: 1 },
        { id: '800000000000000002', type: 2, name: 'Voice', position: 0 },
        { id: '800000000000000001', type: 0, name: 'general', position: 0 },
        { id: '800000000000000003', type: 0, name: 'roster', position: 1, parent_id: '800000000000000009' },
      ],
    })
    const channels = await listChannels({ serverId: SERVER, botToken: 'token', fetchFn })
    expect(channels).toEqual([
      { id: '800000000000000001', name: 'general', category: '', canPost: true },
      { id: '800000000000000004', name: 'officers', category: 'Raiding', canPost: false },
      { id: '800000000000000003', name: 'roster', category: 'Raiding', canPost: true },
    ])
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bot token')
  })

  test('a rejected bot token says the token needs resetting, and is not mistaken for a wrong channel', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ message: '401: Unauthorized' }, 401))
    await expect(listChannels({ serverId: SERVER, botToken: 'stale', fetchFn })).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/reset the token .* DISCORD_BOT_TOKEN/),
    })
    await expect(
      checkChannelInServer({ channelId: '800000000000000001', serverId: SERVER, botToken: 'stale', fetchFn }),
    ).rejects.toThrow(/DISCORD_BOT_TOKEN/)
  })

  test('other Discord failures do not reveal status codes', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 500))
    await expect(listChannels({ serverId: SERVER, botToken: 'token', fetchFn })).rejects.toThrow(
      'Discord could not be reached. Try again shortly.',
    )
  })

  test('a bot removed from the server asks to add it again', async () => {
    const fetchFn = discordApi({ 'GET /users/@me': { id: BOT } })
    await expect(listChannels({ serverId: SERVER, botToken: 'token', fetchFn })).rejects.toThrow(
      /Add it again/,
    )
  })
})

describe('the bot only posts in the connected server', () => {
  test('a channel in the connected server passes; another server or no connection is refused', async () => {
    const fetchFn = discordApi({
      'GET /channels/800000000000000001': { id: '800000000000000001', guild_id: SERVER },
      'GET /channels/900000000000000001': { id: '900000000000000001', guild_id: '900000000000000000' },
    })
    await expect(
      checkChannelInServer({ channelId: '800000000000000001', serverId: SERVER, botToken: 't', fetchFn }),
    ).resolves.toBeUndefined()
    await expect(
      checkChannelInServer({ channelId: '900000000000000001', serverId: SERVER, botToken: 't', fetchFn }),
    ).rejects.toThrow(/not in your connected Discord server/)
    await expect(
      checkChannelInServer({ channelId: '800000000000000001', serverId: null, botToken: 't', fetchFn }),
    ).rejects.toThrow(/Add WhenToRaid to your Discord server/)
  })
})

describe('officer requests', () => {
  test('start returns Discord’s add-bot screen with the bot’s permissions and the state', async () => {
    const { url } = await handleConnect(
      { action: 'start', guildId: GUILD_ID, redirectUri: REDIRECT, state: 'a'.repeat(32) },
      config(),
    )
    const params = new URL(url).searchParams
    expect(Object.fromEntries(params)).toEqual({
      client_id: BOT,
      scope: 'bot',
      permissions: String(VIEW | SEND),
      response_type: 'code',
      redirect_uri: REDIRECT,
      state: 'a'.repeat(32),
    })
  })

  test('link records the server Discord names in the token response, never one from the browser', async () => {
    const fetchFn = discordApi({
      'POST /oauth2/token': { access_token: 'x', guild: { id: SERVER, name: 'After Hours' } },
    })
    const settings = config({ fetchFn })
    const result = await handleConnect(
      { action: 'link', guildId: GUILD_ID, redirectUri: REDIRECT, code: 'abcdefghijkl', guild_id: '1' },
      settings,
    )
    expect(result).toEqual({ serverId: SERVER, serverName: 'After Hours' })
    expect(settings.rpc).toHaveBeenCalledWith('link_discord_server', {
      p_guild_id: GUILD_ID,
      p_server_id: SERVER,
      p_server_name: 'After Hours',
    })
    const sent = new URLSearchParams(fetchFn.mock.calls[0][1].body)
    expect(sent.get('grant_type')).toBe('authorization_code')
    expect(sent.get('redirect_uri')).toBe(REDIRECT)
    expect(sent.get('client_secret')).toBe('secret')
  })

  test('a code Discord refuses links nothing', async () => {
    const settings = config({ fetchFn: discordApi({}) })
    await expect(
      handleConnect(
        { action: 'link', guildId: GUILD_ID, redirectUri: REDIRECT, code: 'abcdefghijkl' },
        settings,
      ),
    ).rejects.toMatchObject({ status: 502 })
    expect(settings.rpc).not.toHaveBeenCalled()
  })

  test('channels need a connected server; nothing works until the bot is set up', async () => {
    await expect(
      handleConnect({ action: 'channels', guildId: GUILD_ID }, config({ linkedServer: async () => null })),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      handleConnect({ action: 'channels', guildId: GUILD_ID }, config({ clientSecret: '' })),
    ).rejects.toMatchObject({ status: 503 })
    await expect(
      handleConnect(
        { action: 'start', guildId: GUILD_ID, redirectUri: 'https://evil.example/', state: 'a'.repeat(32) },
        config(),
      ),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('the browser side of connecting', () => {
  function memoryStorage() {
    const items = new Map()
    return {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => items.set(key, String(value)),
      removeItem: (key) => items.delete(key),
    }
  }
  const client = (data, error = null) => ({ functions: { invoke: vi.fn(async () => ({ data, error })) } })

  test('a round trip through Discord links the guild that started it', async () => {
    const storage = memoryStorage()
    const go = vi.fn()
    await startDiscordConnect(client({ url: 'https://discord.com/oauth2/authorize?x' }), GUILD_ID, {
      storage,
      go,
    })
    expect(go).toHaveBeenCalledWith('https://discord.com/oauth2/authorize?x')
    const { state } = JSON.parse(storage.getItem('whentoraid-discord-connect'))
    storage.setItem('whentoraid-discord-return', JSON.stringify({ code: 'abcdefghijkl', state, error: null }))

    const linking = client({ serverId: SERVER, serverName: 'After Hours' })
    expect(await finishDiscordConnect(linking, GUILD_ID, { storage })).toEqual({
      serverId: SERVER,
      serverName: 'After Hours',
    })
    expect(linking.functions.invoke).toHaveBeenCalledWith('discord-connect', {
      body: expect.objectContaining({ action: 'link', guildId: GUILD_ID, code: 'abcdefghijkl' }),
    })
    expect(await finishDiscordConnect(linking, GUILD_ID, { storage })).toBeNull()
  })

  test('a return this tab did not start, or for another guild, is refused without calling the server', async () => {
    const storage = memoryStorage()
    storage.setItem('whentoraid-discord-connect', JSON.stringify({ state: 's1', guildId: GUILD_ID }))
    storage.setItem('whentoraid-discord-return', JSON.stringify({ code: 'abcdefghijkl', state: 'forged' }))
    const linking = client({})
    await expect(finishDiscordConnect(linking, GUILD_ID, { storage })).rejects.toThrow(
      /could not be verified/,
    )

    storage.setItem('whentoraid-discord-connect', JSON.stringify({ state: 's1', guildId: 'another' }))
    storage.setItem('whentoraid-discord-return', JSON.stringify({ code: 'abcdefghijkl', state: 's1' }))
    await expect(finishDiscordConnect(linking, GUILD_ID, { storage })).rejects.toThrow(/another guild/)
    expect(linking.functions.invoke).not.toHaveBeenCalled()
  })

  test('the server’s own error message reaches the officer', async () => {
    const failing = client(null, {
      context: new Response(JSON.stringify({ error: 'Only officers can connect Discord.' })),
    })
    await expect(
      startDiscordConnect(failing, GUILD_ID, { storage: memoryStorage(), go: vi.fn() }),
    ).rejects.toThrow('Only officers can connect Discord.')
  })
})
