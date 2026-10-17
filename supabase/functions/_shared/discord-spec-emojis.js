import { SPEC_ICONS, specEmojiName, specIconUrl } from './spec-icons.js'

const API = 'https://discord.com/api/v10'
const SNOWFLAKE = /^\d{17,20}$/
const CACHE_MS = 5 * 60 * 1000
const RETRY_MS = 30 * 1000

export const SPEC_EMOJI_CATALOG = Object.entries(SPEC_ICONS).flatMap(([characterClass, specs]) =>
  Object.keys(specs).map((spec) => ({
    name: specEmojiName(characterClass, spec),
    url: specIconUrl(characterClass, spec),
  })),
)
const NAMES = new Set(SPEC_EMOJI_CATALOG.map(({ name }) => name))

async function listEmojis(applicationId, botToken, fetchFn) {
  if (!SNOWFLAKE.test(applicationId ?? '') || !botToken)
    throw new Error('Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN to load spec icons.')
  const response = await fetchFn(`${API}/applications/${applicationId}/emojis`, {
    headers: { Authorization: `Bot ${botToken}` },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`Discord spec icon lookup returned ${response.status}.`)
  const data = await response.json()
  if (!Array.isArray(data.items)) throw new Error('Discord returned an invalid spec icon list.')
  return Object.fromEntries(
    data.items
      .filter((emoji) => NAMES.has(emoji.name) && SNOWFLAKE.test(emoji.id ?? '') && emoji.available !== false)
      .map(({ name, id }) => [name, id]),
  )
}

/** One cache per Edge Function instance; an icon outage must not stop roster delivery. */
export function createSpecEmojiLoader({
  applicationId,
  botToken,
  fetchFn = fetch,
  now = Date.now,
  log = console.error,
}) {
  let icons = {},
    expires = 0,
    pending = null
  return async () => {
    if (now() < expires) return icons
    if (pending) return pending
    pending = (async () => {
      try {
        icons = await listEmojis(applicationId, botToken, fetchFn)
        expires = now() + CACHE_MS
        if (Object.keys(icons).length < NAMES.size)
          log('Some Discord spec icons are missing. Run npm run discord:spec-icons to install them.')
      } catch (error) {
        expires = now() + RETRY_MS
        log(error.message)
      } finally {
        pending = null
      }
      return icons
    })()
    return pending
  }
}

/** Explicit setup action: add missing artwork to the application, never overwrite or delete emojis. */
export async function installSpecEmojis({ applicationId, botToken, fetchFn = fetch, progress = () => {} }) {
  const icons = await listEmojis(applicationId, botToken, fetchFn)
  for (const { name, url } of SPEC_EMOJI_CATALOG) {
    if (icons[name]) continue
    // Only catalog URLs are fetched; the bot credential is never sent to the image host.
    const artwork = await fetchFn(url, { signal: AbortSignal.timeout(10000) })
    if (!artwork.ok) throw new Error(`Could not fetch ${name}: ${artwork.status}.`)
    const bytes = new Uint8Array(await artwork.arrayBuffer())
    if (!bytes.length || bytes.length > 256 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
      throw new Error(`Invalid JPEG artwork for ${name}.`)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const response = await fetchFn(`${API}/applications/${applicationId}/emojis`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, image: `data:image/jpeg;base64,${btoa(binary)}` }),
      signal: AbortSignal.timeout(10000),
    })
    // A rerun lists existing names first, so even an interrupted upload resumes without duplication.
    if (!response.ok)
      throw new Error(`Uploading ${name} returned ${response.status}. Rerun setup later to resume.`)
    const emoji = await response.json()
    if (!SNOWFLAKE.test(emoji.id ?? '')) throw new Error(`Discord returned an invalid ID for ${name}.`)
    icons[name] = emoji.id
    progress(name)
  }
  return icons
}
