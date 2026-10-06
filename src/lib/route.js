import { isIsoDate, mondayOf } from './time.js'
import { DEFAULT_RAID_ID } from './raids.js'

/** Every page, in sidebar order. The first is the default. */
export const VIEWS = ['planner', 'availability', 'characters', 'members', 'settings']

/**
 * The page and week named by a URL hash such as `#/planner/2026-10-05`. Hash routing works on any
 * static host, including GitHub Pages, without server rewrites.
 * @returns {{ view: string, week: string | null }} `week` is a Monday, or null when the hash has none.
 */
export function parseHash(hash) {
  const [view, week, raid] = String(hash ?? '')
    .replace(/^#\/?/, '')
    .split('/')
  return {
    view: VIEWS.includes(view) ? view : VIEWS[0],
    week: isIsoDate(week) ? mondayOf(week) : null,
    ...(raid && /^[a-z0-9-]{1,64}$/.test(raid) ? { raid } : {}),
  }
}

export function formatHash(view, week, raidId = DEFAULT_RAID_ID) {
  return `#/${view}/${week}${raidId === DEFAULT_RAID_ID ? '' : `/${raidId}`}`
}
