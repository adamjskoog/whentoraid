import { showToast } from './toast.svelte.js'

/**
 * A page with unsaved edits (Guild settings) registers a guard; anything that would leave the page
 * or replace its form asks `requestLeave` first.
 * @typedef {{ isDirty: () => boolean, discard: () => void }} LeaveGuard
 */

/** @type {LeaveGuard | null} */
let guard = null

/** @param {LeaveGuard} next @returns {() => void} removes the guard again */
export function setLeaveGuard(next) {
  guard = next
  return () => {
    if (guard === next) guard = null
  }
}

export function hasUnsavedChanges() {
  return Boolean(guard?.isDirty())
}

/**
 * Run `leave` now, or, with unsaved changes, offer to discard them first.
 * @param {() => void} leave
 * @returns {boolean} whether `leave` ran right away
 */
export function requestLeave(leave) {
  if (!hasUnsavedChanges()) {
    leave()
    return true
  }
  const pending = guard
  showToast('You have unsaved guild settings. Save them, or discard them to continue.', {
    label: 'Discard changes',
    run: () => {
      pending.discard()
      leave()
    },
  })
  return false
}
