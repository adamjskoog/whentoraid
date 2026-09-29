<script>
  import CharacterFields from '../components/CharacterFields.svelte'
  import { app } from '../lib/app.svelte.js'
  import { readCharacterFields, HOUR_OPTIONS } from '../lib/forms.js'
  import { timeZoneOptions } from '../lib/guild.js'
  import { createSeedState } from '../lib/seed.js'
  import { createGuildState } from '../lib/setup.js'

  const DEFAULT_START_HOUR = 17
  const DEFAULT_END_HOUR = 24

  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const zones = timeZoneOptions(browserZone)

  let error = $state('')

  function create(event) {
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
    app.data = result.state
  }

  function loadDemo() {
    app.view = 'planner'
    app.data = createSeedState()
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

    <form class="panel spaced-top" onsubmit={create}>
      <h2>Your guild</h2>
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
            {#each HOUR_OPTIONS.slice(0, -1) as hour (hour.value)}
              <option value={hour.value} selected={hour.value === DEFAULT_START_HOUR}>{hour.label}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          Raids must end by
          <select name="endHour">
            {#each HOUR_OPTIONS.slice(1) as hour (hour.value)}
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
        <button class="primary">Create guild</button>
      </div>
    </form>

    <section class="panel spaced-top">
      <h2>Just looking?</h2>
      <p>Explore a sample guild of 24 players with a week of availability already filled in.</p>
      <button onclick={loadDemo}>Explore the demo guild</button>
    </section>
  </div>
</main>
