<script>
  import { app } from '../lib/app.svelte.js'
  import { raidCharactersOf } from '../lib/model.js'
  import Modal from './Modal.svelte'

  let { open, role, benchMembers, onchoose, onclose } = $props()
</script>

<Modal {open} {onclose} label={`Add a ${role?.toLowerCase()}`}>
  <h2>Add a {role?.toLowerCase()}</h2>
  <p>Unavailable players remain selectable and will be flagged.</p>
  <div class="modal-list">
    {#each benchMembers as member (member.id)}
      <button onclick={() => onchoose(member.id)}>
        {member.name}
        <small
          >{raidCharactersOf(app.data, app.data.currentWeek, member.id)
            .map((c) => c.role)
            .join(' / ')}</small
        >
      </button>
    {:else}
      <p>No players left on the bench.</p>
    {/each}
  </div>
</Modal>
