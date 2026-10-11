import { expect, test } from 'vitest'
import { isSafeId, own } from './ids.js'
import { getCheckin } from './model.js'
import { createSeedState, SEED_WEEK } from './seed.js'

test('generated, seeded, and test ids are safe', () => {
  for (const id of [crypto.randomUUID(), 'm0', 'c12a', 'm-officer', 'raid-10-1', 'A_b-9']) {
    expect(isSafeId(id)).toBe(true)
  }
})

test('names every object inherits, odd characters, and non-strings are refused', () => {
  for (const id of [
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    'valueOf',
    '',
    'a b',
    'a:b',
    'x'.repeat(65),
    7,
    null,
  ]) {
    expect(isSafeId(id)).toBe(false)
  }
})

test('own reads only keys the record has itself', () => {
  expect(own({ a: 1 }, 'a')).toBe(1)
  expect(own({}, 'constructor')).toBeUndefined()
  expect(own(undefined, 'a')).toBeUndefined()
})

test('a member without a check-in never reads an inherited value as one', () => {
  const state = createSeedState()
  expect(getCheckin(state, SEED_WEEK, 'constructor')).toEqual({ checkedIn: false, ranges: [], declined: [] })
})
