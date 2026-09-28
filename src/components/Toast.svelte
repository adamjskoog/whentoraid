<script>
  import { toast } from '../lib/toast.svelte.js'
</script>

<div id="toast" role="status" style:display={toast.visible ? 'block' : 'none'}>{toast.message}</div>
