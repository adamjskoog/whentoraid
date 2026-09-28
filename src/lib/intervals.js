/**
 * Availability is stored as UTC time ranges so it can be shown in any timezone.
 * @typedef {{ start: number, end: number }} Interval  Epoch milliseconds, end exclusive.
 */

/** Sort, drop empty ranges, and merge overlapping or touching ranges. */
export function normalize(ranges) {
  const sorted = ranges
    .filter((r) => r.end > r.start)
    .map((r) => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start - b.start)

  return sorted.reduce((merged, r) => {
    const last = merged.at(-1)
    if (last && r.start <= last.end) {
      return [...merged.slice(0, -1), { start: last.start, end: Math.max(last.end, r.end) }]
    }
    return [...merged, r]
  }, [])
}

export function addInterval(ranges, interval) {
  return normalize([...ranges, interval])
}

export function removeInterval(ranges, { start, end }) {
  return normalize(
    ranges.flatMap((r) => {
      if (r.end <= start || r.start >= end) return [r]
      return [
        { start: r.start, end: start },
        { start: end, end: r.end },
      ]
    }),
  )
}

/** True when one continuous stretch of `ranges` contains all of `interval`. */
export function covers(ranges, { start, end }) {
  return normalize(ranges).some((r) => r.start <= start && r.end >= end)
}
