// Offline support. The page is fetched network-first, so a new deploy shows up on the next load;
// build assets have hashed names and never change, so they are served from the cache first.
// Everything a guild saves lives in localStorage, not here.

const SCOPE = new URL(self.registration.scope)
const CACHE_PREFIX = `whentoraid:${SCOPE.pathname}:`
const CACHE = `${CACHE_PREFIX}v2`
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']
/** On a stalled connection, fall back to the cached page after this long. */
const PAGE_TIMEOUT_MS = 4000

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell())
  self.skipWaiting()
})

/** First-visit scripts load before this worker controls the page; cache them during installation. */
async function cacheAppShell() {
  const cache = await caches.open(CACHE)
  await cache.add('./')
  const page = await cache.match('./')
  const html = await page.text()
  const assets = [...html.matchAll(/(?:src|href)=["']\.?\/?(assets\/[\w.-]+)["']/g)].map(
    (match) => new URL(match[1], SCOPE).href,
  )
  await cache.addAll([...new Set(assets)])
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

/** Drop cached build assets the new page no longer references, so old builds do not pile up. */
async function pruneAssets(cache, html) {
  const used = new Set(html.match(/assets\/[\w.-]+/g) ?? [])
  const requests = await cache.keys()
  await Promise.all(
    requests
      .filter((request) => /\/assets\//.test(request.url))
      .filter((request) => !used.has(new URL(request.url).pathname.replace(/^.*\/(assets\/)/, '$1')))
      .map((request) => cache.delete(request)),
  )
}

async function refreshPage(cache, response) {
  await cache.put('./', response.clone())
  try {
    await pruneAssets(cache, await response.clone().text())
  } catch {
    // Pruning is housekeeping; a failure must not replace the fresh page with the cached one.
  }
}

/** Cache storage is an optional optimization: quota errors must never break a successful request. */
async function openCache() {
  try {
    return await caches.open(CACHE)
  } catch {
    return null
  }
}

async function cachedResponse(cache, request, options) {
  try {
    return await cache?.match(request, options)
  } catch {
    return undefined
  }
}

async function storeResponse(cache, request, response) {
  try {
    await cache?.put(request, response.clone())
  } catch {
    // The network response is still usable when caching is blocked or full.
  }
}

async function networkFirstPage(request, event) {
  const cache = await openCache()
  const network = fetch(request).then(async (response) => {
    if (response.ok && cache) {
      try {
        await refreshPage(cache, response)
      } catch {
        // A working page must not depend on a successful cache write.
      }
    }
    return response
  })
  // A timed-out navigation can return its cached page while the fresh copy finishes downloading.
  event.waitUntil(network.catch(() => {}))
  let timer
  const timeout = new Promise((resolve) => (timer = setTimeout(resolve, PAGE_TIMEOUT_MS)))
  let response
  try {
    response = await Promise.race([network, timeout])
    if (response && response.status < 500) return response
  } catch {
    // Offline: use the cached page below.
  } finally {
    clearTimeout(timer)
  }
  const cached = await cachedResponse(cache, './')
  if (cached) return cached
  return response ?? network.catch(() => Response.error())
}

/** Hashed build assets and font files never change: serve them from the cache when present. */
async function cacheFirst(request, ignoreVary = false) {
  const cache = await openCache()
  // Static, hashed app assets have identical content regardless of the Origin request header.
  // Preview/CDN Vary: Origin headers must not prevent an install-time copy serving a module load.
  const cached = await cachedResponse(cache, request, { ignoreVary })
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok || response.type === 'opaque') await storeResponse(cache, request, response)
  return response
}

/** Icons and the manifest can change between deploys: serve the cached copy, refresh it behind. */
async function staleWhileRevalidate(request, event) {
  const cache = await openCache()
  const cached = await cachedResponse(cache, request)
  const fresh = fetch(request).then(async (response) => {
    if (response.ok) await storeResponse(cache, request, response)
    return response
  })
  if (!cached) return fresh
  event.waitUntil(fresh.catch(() => {}))
  return cached
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Only the app page itself is cached as the offline page; other pages (privacy, terms) are not.
  const local = url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname)
  const path = local ? url.pathname.slice(SCOPE.pathname.length) : null
  const appPage = path === '' || path === 'index.html'
  if (request.mode === 'navigate' && appPage) {
    event.respondWith(networkFirstPage(request, event))
  } else if (request.mode === 'navigate') {
    return
  } else if (FONT_HOSTS.includes(url.hostname) || (local && path.startsWith('assets/'))) {
    event.respondWith(cacheFirst(request, local))
  } else if (
    local &&
    /^(icon(?:-maskable)?(?:-\d+)?\.(png|svg)|apple-touch-icon\.png|manifest\.webmanifest)$/.test(path)
  ) {
    event.respondWith(staleWhileRevalidate(request, event))
  }
})
