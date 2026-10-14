import { isIsoDate, mondayOf } from './time.js'
import { DEFAULT_RAID_ID } from './raids.js'

/** Every page, in sidebar order. The first is the default. */
export const VIEWS = ['home', 'planner', 'availability', 'characters', 'members', 'settings']

/**
 * The page and week named by a URL hash such as `#/planner/2026-10-05`. Hash routing works on any
 * static host, including GitHub Pages, without server rewrites.
 * @returns {{ view: string, week: string | null }} `week` is a Monday, or null when the hash has none.
 */
export function parseHash(hash) {
  const [view, week, raid] = String(hash ?? '')
    .replace(/^#\/?/, '')
    .split('/')
  // `#/published/<week>/<raid>` is a shareable link to a published roster, shown in the planner.
  const published = view === 'published'
  return {
    view: published ? 'planner' : VIEWS.includes(view) ? view : VIEWS[0],
    week: isIsoDate(week) ? mondayOf(week) : null,
    ...(raid && /^[a-z0-9-]{1,64}$/.test(raid) ? { raid } : {}),
    ...(published ? { published: true } : {}),
  }
}

/**
 * A link that opens one raid's published roster in an online guild, for players to share.
 * @param {{ origin: string, pathname: string }} location where the app is served
 */
export function publishedRosterUrl(location, guildId, week, raidId) {
  const query = new URLSearchParams({ guild: guildId })
  return `${location.origin}${location.pathname}?${query}#/published/${week}/${raidId}`
}

export function formatHash(view, week, raidId = DEFAULT_RAID_ID) {
  return `#/${view}/${week}${raidId === DEFAULT_RAID_ID ? '' : `/${raidId}`}`
}
