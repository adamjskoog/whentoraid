<script>
  import Modal from './Modal.svelte'
  import { acceptInvite, dismissInvite, invite } from '../lib/remote/invite.svelte.js'
  import { remote, signIn } from '../lib/remote/sync.svelte.js'

  /** Personal links name a single profile; general links create a new member. */
  const player = $derived(invite.details?.openPlayers[0] ?? null)
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
      await acceptInvite({ memberId: player?.id ?? null, name })
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
      {#if player}
        <p>
          This is a personal invite for {player.name}. Joining links your Discord account to their characters
          and history.
        </p>
        <p class="note">
          If this is not your profile, close this dialog and ask an officer for your own link.
        </p>
      {:else}
        <p>
          Join as a new player. If an officer already added your profile, ask them for a personal invite to
          keep your characters and history.
        </p>
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
