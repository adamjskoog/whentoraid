<script>
  import { parseBackup } from '../lib/storage.js'
  import { showToast } from '../lib/toast.svelte.js'

  /** A file picker styled as a button. Calls `onrestore(state)` with a valid backup's guild. */
  let { onrestore, label = 'Restore from backup…' } = $props()

  async function pick(event) {
    const input = event.currentTarget
    const file = input.files?.[0]
    // Clear the picker so choosing the same file again still fires `change`.
    input.value = ''
    if (!file) return
    let text
    try {
      text = await file.text()
    } catch {
      showToast('That file could not be read.')
      return
    }
    const result = parseBackup(text)
    if ('error' in result) {
      showToast(result.error)
      return
    }
    onrestore(result.state)
  }
</script>

<label class="button-like">
  {label}
  <input class="visually-hidden" type="file" accept=".json,application/json" onchange={pick} />
</label>
