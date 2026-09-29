import { describe, expect, test } from 'vitest'
import { formatHash, parseHash } from './route.js'

describe('parseHash', () => {
  test('reads the page and week', () => {
    expect(parseHash('#/members/2026-10-05')).toEqual({ view: 'members', week: '2026-10-05' })
  })

  test('snaps a mid-week date to its Monday', () => {
    expect(parseHash('#/planner/2026-10-08').week).toBe('2026-10-05')
  })

  test('falls back to the planner and no week for empty or unknown hashes', () => {
    expect(parseHash('')).toEqual({ view: 'planner', week: null })
    expect(parseHash('#/admin/not-a-date')).toEqual({ view: 'planner', week: null })
    expect(parseHash(undefined)).toEqual({ view: 'planner', week: null })
  })

  test('accepts a page without a week', () => {
    expect(parseHash('#/settings')).toEqual({ view: 'settings', week: null })
  })

  test('round-trips with formatHash', () => {
    expect(parseHash(formatHash('availability', '2026-10-05'))).toEqual({
      view: 'availability',
      week: '2026-10-05',
    })
  })
})
