<script>
  /** Wraps a native <dialog>. The parent owns `open`; `onclose` fires on Esc, ×, or programmatic close. */
  let { open, onclose, children } = $props()
  let dialog

  $effect(() => {
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  })
</script>

<dialog bind:this={dialog} {onclose}>
  <button class="close" aria-label="Close" onclick={() => dialog.close()}>×</button>
  {#if open}
    {@render children()}
  {/if}
</dialog>
