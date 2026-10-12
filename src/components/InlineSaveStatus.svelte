<script>
  import { remote } from '../lib/remote/sync.svelte.js'
  import { localSave } from '../lib/save-status.svelte.js'
  const online = $derived(Boolean(remote.guildId))
  const status = $derived(online ? remote.status : localSave.status)
</script>

<p class="save-status" class:warning={status === 'error'} role="status" aria-live="polite">
  {#if status === 'saving'}
    Saving…
  {:else if status === 'error'}
    {online
      ? 'Couldn’t save online. Review your unsaved edit above.'
      : 'Couldn’t save in this browser. Keep this page open and download a backup in Guild settings.'}
  {:else}
    {online ? 'Saved online' : 'Saved in this browser'}
  {/if}
</p>

<style>
  .save-status {
    margin: 0.75rem 0;
    font-size: 0.85rem;
  }
</style>
