/**
 * Member, character, and raid ids key plain objects (check-ins by member, plans by raid). A key
 * every object inherits, such as `constructor`, would read back as a built-in function, so such
 * ids are refused wherever ids enter the app. Keep in step with valid_entity_id in
 * supabase/migrations/20261011120000_audit_hardening.sql.
 */
const INHERITED_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype))

/** @returns {boolean} whether `id` is a usable member or character id */
export function isSafeId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) && !INHERITED_NAMES.has(id)
}

/** `record[key]` when `record` has that key itself; never an inherited value. */
export function own(record, key) {
  return record != null && Object.hasOwn(record, key) ? record[key] : undefined
}
