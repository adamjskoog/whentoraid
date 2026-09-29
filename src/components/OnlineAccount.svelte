<script>
  import { app } from '../lib/app.svelte.js'
  import {
    closeGuild,
    createOnlineGuild,
    localTestSignIn,
    localTestSignInAvailable,
    openGuild,
    remote,
    signIn,
    signOut,
  } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /** Sign-in, choosing an online guild, and moving the browser guild online. */
  let busy = $state(false)

  async function run(action, done) {
    busy = true
    try {
      await action()
      if (done) showToast(done)
    } catch (error) {
      showToast(error.message)
    } finally {
      busy = false
    }
  }

  const moveOnline = () =>
    run(
      () => createOnlineGuild($state.snapshot(app.data)),
      'Your guild is online. Invite players by adding their Discord IDs.',
    )
</script>

{#if !remote.enabled}
  <p>This copy of WhenToRaid has no server connected. Everything is saved in this browser only.</p>
  <p class="note">
    To play together, host it with a Supabase project (see the README): players then sign in with Discord and
    see the same guild.
  </p>
{:else if !remote.ready}
  <p>Checking sign-in…</p>
{:else if !remote.signedIn}
  <p>
    Sign in with Discord to plan with your guild online. Everyone sees the same roster, and each player fills
    in their own availability.
  </p>
  <button class="primary" onclick={signIn}>Sign in with Discord</button>
  {#if localTestSignInAvailable}
    <div class="local-test-sign-in spaced-top">
      <p class="note">
        Local development only: sign in as a test player without Discord. The test officer’s Discord ID is
        <code>100000000000000001</code>, the test player’s <code>100000000000000002</code>; add the player’s
        ID to a member to invite them.
      </p>
      <div class="buttons">
        <button disabled={busy} onclick={() => run(() => localTestSignIn('officer'))}
          >Sign in as test officer</button
        >
        <button disabled={busy} onclick={() => run(() => localTestSignIn('player'))}
          >Sign in as test player</button
        >
      </div>
    </div>
  {/if}
{:else}
  <p>
    Signed in with Discord.
    {#if remote.discordId}
      Your Discord ID is <code>{remote.discordId}</code>. Officers add it to a player to let you in.
    {/if}
  </p>

  {#if remote.guilds.length}
    <h3>Your online guilds</h3>
    <div class="buttons">
      {#each remote.guilds as guild (guild.id)}
        <button
          class:primary={guild.id === remote.guildId}
          disabled={busy || guild.id === remote.guildId}
          onclick={() => run(() => openGuild(guild.id))}
        >
          {guild.name}{guild.id === remote.guildId ? ' (open)' : ''}
        </button>
      {/each}
    </div>
  {:else}
    <p class="note">No online guild lists you yet. Ask an officer to add your Discord ID, or create one.</p>
  {/if}

  <div class="buttons spaced-top">
    {#if remote.guildId}
      <button disabled={busy} onclick={closeGuild}>Use the guild saved in this browser</button>
    {:else if app.data}
      <button class="primary" disabled={busy} onclick={moveOnline}>Move “{app.data.guild.name}” online</button
      >
    {/if}
    <button disabled={busy} onclick={signOut}>Sign out</button>
  </div>
{/if}
