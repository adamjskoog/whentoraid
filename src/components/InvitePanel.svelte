<script>
  import {
    createInvite,
    createMemberInvite,
    currentInvite,
    disableInvite,
    disableMemberInvite,
  } from '../lib/remote/api.js'
  import { app } from '../lib/app.svelte.js'
  import { supabase } from '../lib/remote/client.js'
  import { flushOnlineChanges, remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /** Officers share this link so players can join the online guild themselves. */
  let code = $state(null)
  let loaded = $state(false)
  let busy = $state(false)
  /** Resetting ends every link already shared, so it takes two clicks. */
  let confirmReset = $state(false)
  let memberId = $state('')
  let personalCode = $state(null)
  const available = $derived(
    (app.data?.members ?? []).filter((member) => !member.discordId && !member.officer),
  )
  const personalLink = $derived(
    personalCode ? `${location.origin}${location.pathname}?join=${personalCode}` : '',
  )

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

  async function copy(value = link) {
    try {
      await navigator.clipboard.writeText(value)
      showToast('Invite link copied. Paste it in your guild’s Discord.')
    } catch {
      showToast('Your browser blocked copying. Select the link and copy it.')
    }
  }

  const makePersonal = () =>
    run(async () => {
      // A player added a moment ago must reach the server before they can be invited.
      await flushOnlineChanges()
      personalCode = await createMemberInvite(supabase, remote.guildId, memberId)
    }, 'Personal invite created. Send it privately to this player. It expires in seven days.')

  const revokePersonal = () =>
    run(async () => {
      await disableMemberInvite(supabase, remote.guildId, memberId)
      personalCode = null
    }, 'This player’s personal invite has been revoked.')
</script>

<section class="panel spaced-top" aria-labelledby="invite-heading">
  <h2 id="invite-heading">Invite link</h2>
  {#if !loaded}
    <p class="note">Loading…</p>
  {:else if !code}
    <p>
      Share a link in your guild’s Discord so new players can sign in and add themselves. Use a personal
      invite below for a profile you already added.
    </p>
    <button class="primary" disabled={busy} onclick={turnOn}>Create invite link</button>
  {:else}
    <p>
      Anyone with this link can join as a new player after signing in with Discord. Existing profiles require
      a personal invite. Share this link only with your guild.
    </p>
    <label class="field">
      Invite link
      <input readonly value={link} onfocus={(e) => e.currentTarget.select()} />
    </label>
    <div class="buttons">
      <button class="primary" onclick={() => copy()}>Copy link</button>
      <button class:danger={confirmReset} disabled={busy} onclick={reset}
        >{confirmReset ? 'Click again: old links stop working' : 'Reset link'}</button
      >
      <button disabled={busy} onclick={turnOff}>Turn off</button>
    </div>
  {/if}
  {#if available.length}
    <h3 class="spaced-top">Personal player invite</h3>
    <p>
      Connect an existing profile to its player. Send this link privately; it works once, expires in seven
      days, and cannot claim another profile.
    </p>
    <label class="field">
      Existing player
      <select
        bind:value={memberId}
        onchange={() => {
          personalCode = null
        }}
      >
        <option value="">Choose a player</option>
        {#each available as member (member.id)}<option value={member.id}>{member.name}</option>{/each}
      </select>
    </label>
    <div class="buttons">
      <button disabled={busy || !memberId} onclick={makePersonal}>Create personal invite</button>
      <button disabled={busy || !memberId} onclick={revokePersonal}>Revoke personal invite</button>
    </div>
    <p class="note">Creating a link replaces any previous personal link for this player.</p>
    {#if personalLink}
      <label class="field"
        >Personal invite link<input
          readonly
          value={personalLink}
          onfocus={(e) => e.currentTarget.select()}
        /></label
      >
      <button onclick={() => copy(personalLink)}>Copy personal link</button>
    {/if}
  {/if}
</section>
