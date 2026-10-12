<script>
  import Modal from './Modal.svelte'
  import { acceptInvite, dismissInvite, invite } from '../lib/remote/invite.svelte.js'
  import { remote, signIn } from '../lib/remote/sync.svelte.js'

  /** Joining a guild from an invite link: sign in, then pick your name on the list or add yourself. */
  const NEW_PLAYER = ''
  let choice = $state(NEW_PLAYER)
  let name = $state('')

  // Offer the Discord display name once the invite has loaded.
  $effect(() => {
    if (invite.status === 'ready' && !name) name = invite.suggestedName
  })

  /** Shown in the dialog: a toast would sit behind it. */
  let error = $state(null)

  async function join(event) {
    event.preventDefault()
    error = null
    try {
      await acceptInvite({ memberId: choice || null, name })
    } catch (failure) {
      error = failure.message
    }
  }
</script>

<Modal open={invite.code !== null && remote.ready} onclose={dismissInvite}>
  {#if !remote.signedIn}
    <h2>You’re invited to a raid team</h2>
    <p>
      Sign in with Discord to join the guild. Your officers plan raids around everyone’s availability here.
    </p>
    <div class="buttons">
      <button class="primary" onclick={signIn}>Sign in with Discord</button>
      <button onclick={dismissInvite}>Not now</button>
    </div>
  {:else if invite.status === 'error'}
    <h2>Invite link</h2>
    <p class="warning">{invite.error}</p>
    <div class="buttons"><button onclick={dismissInvite}>Close</button></div>
  {:else if invite.details && (invite.status === 'ready' || invite.status === 'joining')}
    <h2>Join {invite.details.guildName}</h2>
    <form onsubmit={join}>
      {#if invite.details.openPlayers.length}
        <p>If an officer already added you, pick your name so your characters and history stay with you.</p>
        <label class="field">
          Who are you?
          <select bind:value={choice}>
            <option value={NEW_PLAYER}>I’m not on the list</option>
            {#each invite.details.openPlayers as player (player.id)}
              <option value={player.id}>{player.name}</option>
            {/each}
          </select>
        </label>
      {/if}
      {#if choice === NEW_PLAYER}
        <label class="field">
          Your name in the guild
          <input required maxlength="30" autocomplete="nickname" bind:value={name} />
        </label>
      {/if}
      {#if error}<p class="warning" role="alert">{error}</p>{/if}
      <div class="buttons spaced-top">
        <button class="primary" disabled={invite.status === 'joining'}
          >{invite.status === 'joining' ? 'Joining…' : 'Join guild'}</button
        >
        <button type="button" onclick={dismissInvite}>Not now</button>
      </div>
    </form>
  {:else}
    <h2>Invite link</h2>
    <p>Checking your invite…</p>
  {/if}
</Modal>
