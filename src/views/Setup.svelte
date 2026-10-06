<script>
  import CharacterFields from '../components/CharacterFields.svelte'
  import OnlineAccount from '../components/OnlineAccount.svelte'
  import RestoreButton from '../components/RestoreButton.svelte'
  import { app } from '../lib/app.svelte.js'
  import { END_HOUR_OPTIONS, readCharacterFields, START_HOUR_OPTIONS } from '../lib/forms.js'
  import { timeZoneOptions } from '../lib/guild.js'
  import { createDemoState } from '../lib/seed.js'
  import { createOnlineGuild, remote } from '../lib/remote/sync.svelte.js'
  import { createGuildState } from '../lib/setup.js'
  import { downloadText } from '../lib/download.js'
  import { unreadableReason } from '../lib/storage.js'
  import { showToast } from '../lib/toast.svelte.js'

  const DEFAULT_START_HOUR = 17
  const DEFAULT_END_HOUR = 24

  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const zones = timeZoneOptions(browserZone)

  let error = $state('')
  let creating = $state(false)
  /** Signed in: new guilds are created online, with you as their first officer. */
  const online = $derived(remote.enabled && remote.signedIn)

  async function create(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const result = createGuildState({
      guildName: String(form.get('guildName') ?? ''),
      timezone: String(form.get('timezone') ?? ''),
      startHour: Number(form.get('startHour')),
      endHour: Number(form.get('endHour')),
      memberName: String(form.get('memberName') ?? ''),
      discordId: String(form.get('discordId') ?? ''),
      character: readCharacterFields(form, 'character-'),
    })
    if ('error' in result) {
      error = result.error
      return
    }
    app.view = 'members'
    if (!online) {
      app.data = result.state
      return
    }
    creating = true
    try {
      await createOnlineGuild(result.state)
    } catch (failure) {
      error = failure.message
    } finally {
      creating = false
    }
  }

  function loadDemo() {
    app.view = 'planner'
    app.data = createDemoState()
  }

  function restore(state) {
    app.view = 'planner'
    app.data = state
    showToast(`Restored ${state.guild.name} from the backup.`)
  }

  function downloadUnreadable() {
    downloadText('whentoraid-unreadable-save.json', app.unreadable, 'application/json')
  }
</script>

<main class="setup">
  <div class="setup-inner">
    <div class="brand setup-brand">
      <span class="crest">W</span>
      <span>WHEN<span class="gold">TO</span>RAID<small>THE GUILD WAR ROOM</small></span>
    </div>
    <p class="eyebrow gold">FIRST RAID NIGHT STARTS HERE</p>
    <h1>Set up your guild</h1>
    <p class="subtitle">
      Takes a minute. You can add the rest of your guild next, and change any of this later in Guild settings.
    </p>

    {#if app.unreadable}
      <section class="panel spaced-top recovery" role="alert">
        <h2>Your saved guild could not be loaded</h2>
        <p>{unreadableReason(app.unreadable)} A copy has been kept in this browser.</p>
        <p class="note">
          Download it before setting up a new guild. If it came from a newer version, open it there, or
          restore it here once this version is updated.
        </p>
        <div class="buttons">
          <button onclick={downloadUnreadable}>Download the saved data</button>
        </div>
      </section>
    {/if}

    {#if remote.enabled}
      <section class="panel spaced-top">
        <h2>Play together online</h2>
        <OnlineAccount />
      </section>
    {/if}

    <form class="panel spaced-top" onsubmit={create}>
      <h2>Your guild</h2>
      <p>
        Starts with two 10-player raids and one 20-player raid. Rename them and tune each composition in Guild
        settings.
      </p>
      <div class="settings-grid">
        <label class="field">Guild name<input name="guildName" required maxlength="60" /></label>
        <label class="field">
          Guild timezone
          <select name="timezone">
            {#each zones as zone (zone)}
              <option selected={zone === browserZone}>{zone}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          Raids can start from
          <select name="startHour">
            {#each START_HOUR_OPTIONS as hour (hour.value)}
              <option value={hour.value} selected={hour.value === DEFAULT_START_HOUR}>{hour.label}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          Raids must end by
          <select name="endHour">
            {#each END_HOUR_OPTIONS as hour (hour.value)}
              <option value={hour.value} selected={hour.value === DEFAULT_END_HOUR}>{hour.label}</option>
            {/each}
          </select>
        </label>
      </div>

      <h2>You</h2>
      <div class="settings-grid">
        <label class="field">Your name<input name="memberName" required maxlength="30" /></label>
        <label class="field">
          Discord user ID (optional)
          <input name="discordId" inputmode="numeric" pattern="[0-9]*" placeholder="Used to @mention you" />
        </label>
        <CharacterFields prefix="character-" />
      </div>

      {#if error}
        <p class="note warning" role="alert">{error}</p>
      {/if}
      <div class="buttons form-actions">
        <button class="primary" disabled={creating}>
          {online ? (creating ? 'Creating…' : 'Create guild online') : 'Create guild'}
        </button>
      </div>
    </form>

    <section class="panel spaced-top">
      <h2>Just looking?</h2>
      <p>
        Explore 24 sample players with a full calendar year of randomized availability and plans for all three
        raids. Every load creates a fresh demo.
      </p>
      <button onclick={loadDemo}>Explore the demo guild</button>
    </section>

    <section class="panel spaced-top">
      <h2>Have a backup?</h2>
      <p>Restore a guild downloaded from Guild settings in this or another browser.</p>
      <RestoreButton onrestore={restore} />
    </section>
  </div>
</main>
