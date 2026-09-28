import { describe, expect, test } from 'vitest'
import { addInterval, covers, normalize, removeInterval } from './intervals.js'

describe('intervals', () => {
  test('normalize sorts, merges touching ranges, and drops empty ones', () => {
    expect(
      normalize([
        { start: 5, end: 7 },
        { start: 0, end: 2 },
        { start: 2, end: 3 },
        { start: 9, end: 9 },
      ]),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 7 },
    ])
  })

  test('addInterval merges with neighbors', () => {
    expect(
      addInterval(
        [
          { start: 0, end: 2 },
          { start: 4, end: 6 },
        ],
        { start: 2, end: 4 },
      ),
    ).toEqual([{ start: 0, end: 6 }])
  })

  test('removeInterval splits a range', () => {
    expect(removeInterval([{ start: 0, end: 6 }], { start: 2, end: 4 })).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 6 },
    ])
  })

  test('covers needs the whole interval inside one merged range', () => {
    expect(
      covers(
        [
          { start: 0, end: 3 },
          { start: 3, end: 6 },
        ],
        { start: 1, end: 5 },
      ),
    ).toBe(true)
    expect(
      covers(
        [
          { start: 0, end: 3 },
          { start: 4, end: 6 },
        ],
        { start: 1, end: 5 },
      ),
    ).toBe(false)
  })

  test('does not mutate its input', () => {
    const ranges = Object.freeze([Object.freeze({ start: 0, end: 6 })])
    expect(() => removeInterval(ranges, { start: 2, end: 4 })).not.toThrow()
    expect(ranges).toEqual([{ start: 0, end: 6 }])
  })
})
