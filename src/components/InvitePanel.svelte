<script>
  import { createInvite, currentInvite, disableInvite } from '../lib/remote/api.js'
  import { supabase } from '../lib/remote/client.js'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /** Officers share this link so players can join the online guild themselves. */
  let code = $state(null)
  let loaded = $state(false)
  let busy = $state(false)
  /** Resetting ends every link already shared, so it takes two clicks. */
  let confirmReset = $state(false)

  const link = $derived(code ? `${location.origin}${location.pathname}?join=${code}` : '')

  $effect(() => {
    const guildId = remote.guildId
    loaded = false
    currentInvite(supabase, guildId).then(
      (found) => {
        if (remote.guildId !== guildId) return
        code = found
        loaded = true
      },
      (error) => showToast(error.message),
    )
  })

  async function run(action, done) {
    busy = true
    try {
      await action()
      showToast(done)
    } catch (error) {
      showToast(error.message)
    } finally {
      busy = false
      confirmReset = false
    }
  }

  const turnOn = () =>
    run(async () => {
      code = await createInvite(supabase, remote.guildId)
    }, 'Invite link created. Share it in your guild’s Discord.')

  function reset() {
    if (!confirmReset) {
      confirmReset = true
      return
    }
    run(async () => {
      code = await createInvite(supabase, remote.guildId, { reset: true })
    }, 'New invite link created. The old link no longer works.')
  }

  const turnOff = () =>
    run(async () => {
      await disableInvite(supabase, remote.guildId)
      code = null
    }, 'Invite link turned off.')

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      showToast('Invite link copied. Paste it in your guild’s Discord.')
    } catch {
      showToast('Your browser blocked copying. Select the link and copy it.')
    }
  }
</script>

<section class="panel spaced-top" aria-labelledby="invite-heading">
  <h2 id="invite-heading">Invite link</h2>
  {#if !loaded}
    <p class="note">Loading…</p>
  {:else if !code}
    <p>
      Share a link in your guild’s Discord. Players who open it sign in with Discord, then pick their name
      from the list below or add themselves.
    </p>
    <button class="primary" disabled={busy} onclick={turnOn}>Create invite link</button>
  {:else}
    <p>
      Anyone with this link can join after signing in with Discord, and can claim any player below who has no
      Discord ID yet. Share it only with your guild.
    </p>
    <label class="field">
      Invite link
      <input readonly value={link} onfocus={(e) => e.currentTarget.select()} />
    </label>
    <div class="buttons">
      <button class="primary" onclick={copy}>Copy link</button>
      <button class:danger={confirmReset} disabled={busy} onclick={reset}
        >{confirmReset ? 'Click again: old links stop working' : 'Reset link'}</button
      >
      <button disabled={busy} onclick={turnOff}>Turn off</button>
    </div>
  {/if}
</section>
