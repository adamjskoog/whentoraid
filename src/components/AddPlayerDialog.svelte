<script>
  import { app } from '../lib/app.svelte.js'
  import { charactersOf } from '../lib/model.js'
  import Modal from './Modal.svelte'

  let { open, role, benchMembers, onchoose, onclose } = $props()
</script>

<Modal {open} {onclose}>
  <h2>Add a {role?.toLowerCase()}</h2>
  <p>Unavailable players remain selectable and will be flagged.</p>
  <div class="modal-list">
    {#each benchMembers as member (member.id)}
      <button onclick={() => onchoose(member.id)}>
        {member.name}
        <small
          >{charactersOf(app.data, member.id)
            .map((c) => c.role)
            .join(' / ')}</small
        >
      </button>
    {:else}
      <p>No players left on the bench.</p>
    {/each}
  </div>
</Modal>
