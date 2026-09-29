import { TOAST_MS, UNDO_TOAST_MS } from './constants.js'
import { app } from './app.svelte.js'

/** `action` is an optional button shown beside the message, such as Undo. */
export const toast = $state({ message: '', visible: false, action: null })

let hideTimer

function hide() {
  toast.visible = false
  toast.action = null
}

/** @param {{ label: string, run: () => void } | null} [action] */
export function showToast(message, action = null) {
  toast.message = message
  toast.visible = true
  toast.action = action
  clearTimeout(hideTimer)
  hideTimer = setTimeout(hide, action ? UNDO_TOAST_MS : TOAST_MS)
}

/** Run the toast's action once, then close the toast. */
export function runToastAction() {
  const action = toast.action
  hide()
  action?.run()
}

/**
 * Show `message` with an Undo button that puts back `previous`, the app data from before a
 * destructive change. Call it right after the change, so `app.data` is the changed state. Data is
 * replaced, never mutated, so both are complete snapshots; Undo refuses once anything else has
 * changed (another edit, another tab), because restoring `previous` would silently discard it.
 */
export function offerUndo(message, previous) {
  const after = app.data
  showToast(message, {
    label: 'Undo',
    run: () => {
      if (app.data !== after) {
        showToast('Can’t undo: there have been other changes since.')
        return
      }
      app.data = previous
      showToast('Undone.')
    },
  })
}
