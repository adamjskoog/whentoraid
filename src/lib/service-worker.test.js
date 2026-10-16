// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, test, vi } from 'vitest'

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')
const scope = 'https://example.test/raid/'

function worker({ cacheFailure = false, networkFailure = false, status = 200 } = {}) {
  const handlers = {}
  const records = new Map()
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, scope).href
  const cache = {
    match: vi.fn(async (request) => records.get(key(request))?.clone()),
    put: vi.fn(async (request, response) => {
      if (cacheFailure) throw new Error('Quota exceeded')
      records.set(key(request), response.clone())
    }),
    keys: async () => [...records.keys()].map((url) => ({ url })),
    delete: async (request) => records.delete(key(request)),
  }
  const caches = {
    open: vi.fn(async () => cache),
    keys: async () => [
      'other-app-v1',
      'whentoraid:/other/:v1',
      'whentoraid:/raid/:v1',
      'whentoraid:/raid/:v2',
    ],
    delete: vi.fn(async () => true),
  }
  const fetch = vi.fn(async () => {
    if (networkFailure) throw new Error('Offline')
    return new Response('Fresh content', { status })
  })
  runInNewContext(source, {
    self: {
      registration: { scope },
      clients: { claim: vi.fn() },
      skipWaiting: vi.fn(),
      addEventListener: (type, fn) => (handlers[type] = fn),
    },
    caches,
    fetch,
    URL,
    Response,
    setTimeout,
    clearTimeout,
  })
  async function request(path, mode = 'cors') {
    const background = []
    let response = null
    handlers.fetch({
      request: { url: new URL(path, scope).href, method: 'GET', mode },
      respondWith: (work) => (response = work),
      waitUntil: (work) => background.push(work),
    })
    const result = await response
    await Promise.all(background)
    return result
  }
  return { handlers, caches, records, fetch, request }
}

test('activation deletes only old caches belonging to this app scope', async () => {
  const { handlers, caches } = worker()
  let done
  handlers.activate({ waitUntil: (work) => (done = work) })
  await done
  expect(caches.delete.mock.calls).toEqual([['whentoraid:/raid/:v1']])
})

test.each(['', 'assets/app-123.js', 'icon.svg'])(
  'cache write failures preserve the response for %s',
  async (path) => {
    const { request } = worker({ cacheFailure: true })
    expect(await (await request(path, path ? 'cors' : 'navigate')).text()).toBe('Fresh content')
  },
)

test('blocked cache access still serves a working network response', async () => {
  const { request, caches } = worker()
  caches.open.mockRejectedValue(new Error('Storage unavailable'))
  expect(await (await request('', 'navigate')).text()).toBe('Fresh content')
  expect(await (await request('assets/app.js')).text()).toBe('Fresh content')
})

test.each([{ networkFailure: true }, { status: 503 }])(
  'offline or unavailable host falls back to the cached app: %j',
  async (options) => {
    const { request, records } = worker(options)
    records.set(scope, new Response('Offline app'))
    expect(await (await request('', 'navigate')).text()).toBe('Offline app')
  },
)

test('API responses, other apps, and external assets are never intercepted', async () => {
  const { request, fetch } = worker()
  for (const path of [
    'api/private',
    '__local-sign-in',
    'https://other.test/assets/private.json',
    '/another-app/',
  ]) {
    expect(await request(path, path.endsWith('/') ? 'navigate' : 'cors')).toBeNull()
  }
  expect(fetch).not.toHaveBeenCalled()
})

test('only the app document becomes the offline fallback', async () => {
  const { request, records } = worker()
  await request('', 'navigate')
  expect(await request('privacy.html', 'navigate')).toBeNull()
  expect(await request('discord-connect.html?code=private', 'navigate')).toBeNull()
  expect(await records.get(scope).text()).toBe('Fresh content')
})
