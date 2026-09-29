<script>
  import { runToastAction, toast } from '../lib/toast.svelte.js'
</script>

<div id="toast" style:display={toast.visible ? 'flex' : 'none'}>
  <span role="status">{toast.message}</span>
  {#if toast.action}
    <button class="toast-action" onclick={runToastAction}>{toast.action.label}</button>
  {/if}
</div>
