<script>
  import { app } from './lib/app.svelte.js'
  import { setCurrentWeek } from './lib/model.js'
  import { DEFAULT_RAID_ID, setCurrentRaid } from './lib/raids.js'
  import { formatHash, parseHash } from './lib/route.js'
  import { initRemote, pushChanges, remote } from './lib/remote/sync.svelte.js'
  import { sameGuild, saveState, watchOtherTabs } from './lib/storage.js'
  import { showToast } from './lib/toast.svelte.js'
  import Modal from './components/Modal.svelte'
  import OnlineAccount from './components/OnlineAccount.svelte'
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

  const ONLINE_LABELS = { saved: 'Online · saved', saving: 'Online · saving…', error: 'Online · not saved' }

  let discordOpen = $state(false)
  let storageWarningShown = false
  /** Set when another tab saved with a newer app version: saving here would overwrite its data. */
  let savingPaused = false

  $effect(() => {
    if (!app.data) return
    const snapshot = $state.snapshot(app.data)
    // An online guild is saved to the server; the browser keeps only its own guild.
    if (remote.guildId) {
      pushChanges(snapshot)
      return
    }
    if (savingPaused) return
    const saved = saveState(snapshot)
    if (!saved && !storageWarningShown) {
      storageWarningShown = true
      showToast('Browser storage is unavailable. Changes last only until this page closes.')
    }
  })

  // Another tab saved or cleared the guild: show its version, so this tab does not overwrite it.
  // Each tab keeps its own week; a save that differs only in the week is someone paging, not an edit.
  $effect(() =>
    watchOtherTabs(
      (state) => {
        if (remote.guildId || sameGuild(state, app.data)) return
        app.data =
          state && app.data
            ? {
                ...state,
                currentWeek: app.data.currentWeek,
                currentRaidId: state.settings.raids.some((raid) => raid.id === app.data.currentRaidId)
                  ? app.data.currentRaidId
                  : state.currentRaidId,
              }
            : state
        if (state) showToast('Updated with changes from another tab.')
      },
      () => {
        savingPaused = true
        showToast('Another tab saved with a newer version of WhenToRaid. Reload this tab to keep editing.')
      },
    ),
  )

  $effect(() => initRemote())

  /** Page changes add a history entry, so Back returns to the previous page; week changes replace it. */
  let lastView = app.view
  $effect(() => {
    if (!app.data) return
    const hash = formatHash(app.view, app.data.currentWeek, app.data.currentRaidId)
    if (location.hash === hash) return
    const url = `${location.pathname}${location.search}${hash}`
    if (app.view === lastView) history.replaceState(null, '', url)
    else history.pushState(null, '', url)
    lastView = app.view
  })

  function followUrl() {
    const route = parseHash(location.hash)
    lastView = route.view
    app.view = route.view
    if (app.data && route.week) app.data = setCurrentWeek(app.data, route.week)
    if (app.data) app.data = setCurrentRaid(app.data, route.raid ?? DEFAULT_RAID_ID)
  }
</script>

<svelte:window onpopstate={followUrl} onhashchange={followUrl} />

{#if app.data}
  <Sidebar />

  <main>
    <header>
      <span>
        {app.data.guild.name.toUpperCase()} <span class="slash">/</span>
        {VIEW_TITLES[app.view]}
      </span>
      <button class="discord" onclick={() => (discordOpen = true)}>
        {remote.guildId ? ONLINE_LABELS[remote.status] : remote.signedIn ? 'Signed in' : 'Discord connection'}
      </button>
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
  <h2>{remote.guildId ? 'Online guild' : 'Connect your guild'}</h2>
  <OnlineAccount />
</Modal>
