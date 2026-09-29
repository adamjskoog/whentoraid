import { loadState } from './storage.js'

/**
 * Shared app state. `data` is replaced, never mutated in place: every change goes
 * through a pure function in lib/ and the result is assigned back.
 * `data` is null until a guild is set up (or the demo guild is loaded); App shows setup then.
 */
export const app = $state({
  /** @type {import('./model.js').AppState | null} */
  data: loadState(),
  view: 'planner',
})
