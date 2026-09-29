/**
 * How this viewer wants times shown. A per-browser preference, not part of the guild, so it is kept
 * under its own key and never shared or backed up.
 */
const LOCAL_TIME_KEY = 'whentoraid-show-local-time'

/** This browser's timezone. */
export const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone

function readPreference() {
  try {
    return localStorage.getItem(LOCAL_TIME_KEY) === '1'
  } catch {
    return false
  }
}

export const display = $state({ localTime: readPreference() })

export function setLocalTime(localTime) {
  display.localTime = localTime
  try {
    localStorage.setItem(LOCAL_TIME_KEY, localTime ? '1' : '0')
  } catch {
    // Without storage the choice lasts until the page closes.
  }
}

/** The timezone to show times in: the viewer's own when they asked for it and it differs. */
export function displayZone(guild) {
  return display.localTime ? viewerZone : guild.timezone
}
