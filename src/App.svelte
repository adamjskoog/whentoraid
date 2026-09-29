<script>
  import { app } from './lib/app.svelte.js'
  import { saveState } from './lib/storage.js'
  import { showToast } from './lib/toast.svelte.js'
  import Modal from './components/Modal.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import Toast from './components/Toast.svelte'
  import Availability from './views/Availability.svelte'
  import Characters from './views/Characters.svelte'
  import Members from './views/Members.svelte'
  import Planner from './views/Planner.svelte'
  import Settings from './views/Settings.svelte'
  import Setup from './views/Setup.svelte'

  const VIEW_TITLES = {
    planner: 'Raid planner',
    availability: 'My availability',
    characters: 'My characters',
    members: 'Guild members',
    settings: 'Guild settings',
  }

  let discordOpen = $state(false)
  let storageWarningShown = false

  $effect(() => {
    if (!app.data) return
    const saved = saveState($state.snapshot(app.data))
    if (!saved && !storageWarningShown) {
      storageWarningShown = true
      showToast('Browser storage is unavailable. Changes last only until this page closes.')
    }
  })
</script>

{#if app.data}
  <Sidebar />

  <main>
    <header>
      <span>
        {app.data.guild.name.toUpperCase()} <span class="slash">/</span>
        {VIEW_TITLES[app.view]}
      </span>
      <button class="discord" onclick={() => (discordOpen = true)}>Discord connection</button>
    </header>

    <div id="content">
      {#if app.view === 'availability'}
        <Availability />
      {:else if app.view === 'characters'}
        <Characters />
      {:else if app.view === 'members'}
        <Members />
      {:else if app.view === 'settings'}
        <Settings />
      {:else}
        <Planner />
      {/if}
    </div>

    <footer>Built for real life. Ready for raid night.<span>WHEN TO RAID · FOREVER</span></footer>
  </main>
{:else}
  <Setup />
{/if}

<Toast />

<Modal open={discordOpen} onclose={() => (discordOpen = false)}>
  <h2>Connect your guild</h2>
  <p>Discord sign-in is not connected yet. Everything is saved in this browser only.</p>
  <p>
    The hosted version will sign in through Discord, verify membership in your server, and match officer role
    IDs before allowing roster changes. Until then, add players on the Guild members page and use “Copy
    reminder” and “Copy for Discord” to post updates.
  </p>
  <p class="note">
    Setup requires a Discord application, a hosted callback URL, and server-side credential storage.
  </p>
</Modal>
