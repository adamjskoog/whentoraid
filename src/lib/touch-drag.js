const LONG_PRESS_MS = 350
const MOVE_TOLERANCE_PX = 10
const PICKUP_VIBRATION_MS = 10
/** Dragging within this distance of the top or bottom of the screen scrolls the page. */
const EDGE_ZONE_PX = 60
const MAX_EDGE_SCROLL_PX = 14

/**
 * Svelte action for touch and pen: press and hold an element to pick it up, drag it,
 * and release over an element with a `data-drop` attribute to call `ondrop(value)`.
 * A quick swipe still scrolls the page. Mouse input is ignored so native
 * HTML drag-and-drop keeps handling it.
 *
 * @param {HTMLElement} node
 * @param {{ ondrop: (dropValue: string) => void }} options
 */
export function touchDrag(node, options) {
  let { ondrop } = options
  /** @type {{ pointerId: number, x: number, y: number, timer: ReturnType<typeof setTimeout>, offset: { x: number, y: number } | null } | null} */
  let press = null
  /** @type {HTMLElement | null} */
  let ghost = null
  /** @type {HTMLElement | null} */
  let target = null
  /** Latest pointer position while dragging, for edge scrolling. */
  let point = null
  let scrollFrame = null

  function preventScroll(event) {
    event.preventDefault()
  }

  // A touch press owns the gesture; keep the browser's own long-press drag and menu out of it.
  function suppressWhilePressed(event) {
    if (press) event.preventDefault()
  }

  function setTarget(next) {
    if (next === target) return
    target?.classList.remove('drop-target')
    next?.classList.add('drop-target')
    target = next
  }

  function moveGhost(x, y) {
    ghost.style.transform = `translate(${x - press.offset.x}px, ${y - press.offset.y}px)`
  }

  function updateTarget() {
    const hit = document.elementFromPoint(point.x, point.y)
    setTarget(hit?.closest('[data-drop]') ?? null)
  }

  // Faster the closer the finger is to the edge; zero outside the edge zones.
  function edgeScrollSpeed(y) {
    const fromBottom = window.innerHeight - y
    if (y < EDGE_ZONE_PX) return -MAX_EDGE_SCROLL_PX * (1 - y / EDGE_ZONE_PX)
    if (fromBottom < EDGE_ZONE_PX) return MAX_EDGE_SCROLL_PX * (1 - fromBottom / EDGE_ZONE_PX)
    return 0
  }

  // On a phone the drop zones are far apart, so dragging near an edge scrolls toward them.
  function scrollNearEdges() {
    const speed = edgeScrollSpeed(point.y)
    if (speed) {
      window.scrollBy(0, speed)
      updateTarget()
    }
    scrollFrame = requestAnimationFrame(scrollNearEdges)
  }

  function pickUp() {
    const rect = node.getBoundingClientRect()
    press.offset = { x: press.x - rect.left, y: press.y - rect.top }
    ghost = /** @type {HTMLElement} */ (node.cloneNode(true))
    ghost.classList.add('drag-ghost')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.style.width = `${rect.width}px`
    document.body.append(ghost)
    moveGhost(press.x, press.y)
    node.classList.add('dragging')
    document.addEventListener('touchmove', preventScroll, { passive: false })
    point = { x: press.x, y: press.y }
    scrollFrame = requestAnimationFrame(scrollNearEdges)
    navigator.vibrate?.(PICKUP_VIBRATION_MS)
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' || press) return
    if (event.target instanceof Element && event.target.closest('button')) return
    press = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(pickUp, LONG_PRESS_MS),
      offset: null,
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
  }

  function onPointerMove(event) {
    if (!press || event.pointerId !== press.pointerId) return
    if (!ghost) {
      // Moving before the hold completes means the user is scrolling.
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE_PX) finish()
      return
    }
    point = { x: event.clientX, y: event.clientY }
    moveGhost(point.x, point.y)
    updateTarget()
  }

  function onPointerUp(event) {
    if (!press || event.pointerId !== press.pointerId) return
    const dropValue = ghost && target ? target.dataset.drop : null
    finish()
    if (dropValue) ondrop(dropValue)
  }

  function onPointerCancel(event) {
    if (press && event.pointerId === press.pointerId) finish()
  }

  function finish() {
    if (press) clearTimeout(press.timer)
    cancelAnimationFrame(scrollFrame)
    scrollFrame = null
    point = null
    setTarget(null)
    ghost?.remove()
    ghost = null
    node.classList.remove('dragging')
    document.removeEventListener('touchmove', preventScroll)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    press = null
  }

  node.addEventListener('pointerdown', onPointerDown)
  node.addEventListener('dragstart', suppressWhilePressed)
  node.addEventListener('contextmenu', suppressWhilePressed)

  return {
    update(next) {
      ondrop = next.ondrop
    },
    destroy() {
      finish()
      node.removeEventListener('pointerdown', onPointerDown)
      node.removeEventListener('dragstart', suppressWhilePressed)
      node.removeEventListener('contextmenu', suppressWhilePressed)
    },
  }
}
