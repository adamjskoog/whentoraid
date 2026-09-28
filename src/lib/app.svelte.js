import { createSeedState } from './seed.js'
import { loadState } from './storage.js'

/**
 * Shared app state. `data` is replaced, never mutated in place: every change goes
 * through a pure function in model.js or planning.js and the result is assigned back.
 */
export const app = $state({
  /** @type {import('./model.js').AppState} */
  data: loadState() ?? createSeedState(),
  view: 'planner',
})
