<script>
  import { app } from '../lib/app.svelte.js'
  import { setCurrentMember } from '../lib/members.js'
  import { memberById } from '../lib/model.js'
  import { remote } from '../lib/remote/sync.svelte.js'

  /**
   * An officer editing another player's availability or characters sees who they are editing on every
   * page, and can go back to themselves in one step. Only online guilds know who "you" are.
   */
  const target = $derived(memberById(app.data, app.data.currentMemberId))
  const me = $derived(remote.memberId ? memberById(app.data, remote.memberId) : null)
  const editingOther = $derived(Boolean(remote.guildId && me && target && me.id !== target.id))
</script>

{#if editingOther}
  <section class="editing-as" role="status" aria-label="Editing as another player">
    <p>
      <strong>Editing as {target.name}.</strong>
      Availability and character changes are saved for {target.name}, not for you. Raid responses are always
      your own.
    </p>
    <button class="primary" onclick={() => (app.data = setCurrentMember(app.data, me.id))}
      >Return to {me.name}</button
    >
  </section>
{/if}

<style>
  .editing-as {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--gold);
    border-left-width: 4px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--gold) 12%, var(--panel));
  }
  .editing-as p {
    margin: 0;
    flex: 1 1 20rem;
    color: var(--text);
  }
</style>
