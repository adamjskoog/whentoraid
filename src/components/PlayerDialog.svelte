<script>
  import { app } from '../lib/app.svelte.js'
  import { charactersOf, getCheckin, isOffered, memberById } from '../lib/model.js'
  import Modal from './Modal.svelte'

  /** Pick which of a member's characters to bring, or move them to the bench. */
  let { open, memberId, inTeam, onpick, onbench, onclose } = $props()

  const member = $derived(memberId ? memberById(app.data, memberId) : null)
  const characters = $derived(memberId ? charactersOf(app.data, memberId) : [])
  const checkin = $derived(memberId ? getCheckin(app.data, app.data.currentWeek, memberId) : null)
</script>

<Modal {open} {onclose}>
  {#if member}
    <h2>{member.name}’s characters</h2>
    <p>Switch characters or adjust this player’s role.</p>
    <div class="modal-list">
      {#each characters as character (character.id)}
        <button onclick={() => onpick(character)}>
          <strong>{character.name}</strong>
          <small>
            {character.spec}
            {character.class} · {character.role}{isOffered(checkin, character.id)
              ? ''
              : ' · Not offered this week'}
          </small>
        </button>
      {/each}
    </div>
    {#if inTeam}
      <button class="spaced-top" onclick={onbench}>Move to bench</button>
    {/if}
  {/if}
</Modal>
