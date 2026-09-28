import { TOAST_MS } from './constants.js'

export const toast = $state({ message: '', visible: false })

let hideTimer

export function showToast(message) {
  toast.message = message
  toast.visible = true
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    toast.visible = false
  }, TOAST_MS)
}
