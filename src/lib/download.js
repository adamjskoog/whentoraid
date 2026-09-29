/** Long enough for the browser to start the download before the object URL is released. */
const DOWNLOAD_URL_LIFETIME_MS = 1000

/** Save `text` as a file through the browser's download prompt. */
export function downloadText(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS)
}
