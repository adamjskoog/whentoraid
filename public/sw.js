// Offline support. The page is fetched network-first, so a new deploy shows up on the next load;
// build assets have hashed names and never change, so they are served from the cache first.
// Everything a guild saves lives in localStorage, not here.

const CACHE = 'whentoraid-v1'
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']
/** On a stalled connection, fall back to the cached page after this long. */
const PAGE_TIMEOUT_MS = 4000

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('./')))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
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

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE)
  const network = fetch(request).then(async (response) => {
    if (response.ok) await refreshPage(cache, response)
    return response
  })
  const timeout = new Promise((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS))
  try {
    const response = await Promise.race([network, timeout])
    if (response) return response
  } catch {
    // Offline: use the cached page below.
  }
  const cached = await cache.match('./')
  if (cached) return cached
  return network.catch(() => Response.error())
}

/** Hashed build assets and font files never change: serve them from the cache when present. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok || response.type === 'opaque') await cache.put(request, response.clone())
  return response
}

/** Icons and the manifest can change between deploys: serve the cached copy, refresh it behind. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  const fresh = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone())
    return response
  })
  if (!cached) return fresh
  fresh.catch(() => {})
  return cached
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(networkFirstPage(request))
  } else if (FONT_HOSTS.includes(url.hostname) || /\/assets\//.test(url.pathname)) {
    event.respondWith(cacheFirst(request))
  } else if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request))
  }
})
