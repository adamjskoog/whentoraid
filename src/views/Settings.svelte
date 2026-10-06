<script>
  import OnlineAccount from '../components/OnlineAccount.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import RestoreButton from '../components/RestoreButton.svelte'
  import RaidSelector from '../components/RaidSelector.svelte'
  import CompositionFields from '../components/CompositionFields.svelte'
  import { getRaid } from '../lib/raids.js'
  import { app } from '../lib/app.svelte.js'
  import { DAYS, ROLES } from '../lib/constants.js'
  import { END_HOUR_OPTIONS, START_HOUR_OPTIONS } from '../lib/forms.js'
  import {
    DEFAULT_CHECKIN_DEADLINE,
    minutesToTimeInput,
    raidHours,
    timeInputToMinutes,
    timeZoneOptions,
  } from '../lib/guild.js'
  import { applySettings } from '../lib/planning.js'
  import { canManage, remote } from '../lib/remote/sync.svelte.js'
  import { createDemoState } from '../lib/seed.js'
  import { downloadText } from '../lib/download.js'
  import { backupJson, clearState } from '../lib/storage.js'
  import { todayIso } from '../lib/time.js'
  import { offerUndo, showToast } from '../lib/toast.svelte.js'

  const settings = $derived(getRaid(app.data))
  const guild = $derived(app.data.guild)
  const hours = $derived(raidHours(guild))
  const zones = $derived(timeZoneOptions(guild.timezone))
  const deadline = $derived(app.data.settings.checkinDeadline ?? DEFAULT_CHECKIN_DEADLINE)

  let hasDeadline = $state(app.data.settings.checkinDeadline !== null)
  /** Both "start over" actions erase the guild, so each takes two clicks: 'demo' | 'new' | null. */
  let confirming = $state(null)

  function save(event) {
    event.preventDefault()
    if (!canManage()) {
      showToast('Only officers can change guild settings.')
      return
    }
    const form = new FormData(event.currentTarget)
    const result = applySettings(app.data, {
      raidName: String(form.get('raidName') ?? ''),
      raidSize: Number(form.get('raidSize')),
      targets: ROLES.map((_, i) => Number(form.get(`role${i}`))),
      durationSlots: Number(form.get('duration')),
      discordServerId: String(form.get('discordServerId') ?? '').trim(),
      officerRoleIds: String(form.get('officerRoleIds') ?? '').trim(),
      guildName: String(form.get('guildName') ?? ''),
      timezone: String(form.get('timezone') ?? ''),
      startHour: Number(form.get('startHour')),
      endHour: Number(form.get('endHour')),
      checkinDeadline: hasDeadline
        ? { day: Number(form.get('deadlineDay')), minutes: timeInputToMinutes(form.get('deadlineTime')) }
        : null,
    })
    if (result.error) {
      showToast(result.error)
      return
    }
    app.data = result.state
    showToast('Guild settings and selected raid composition saved')
    app.view = 'planner'
  }

  function loadDemo() {
    if (confirming !== 'demo') {
      confirming = 'demo'
      return
    }
    const previous = app.data
    app.view = 'planner'
    app.data = createDemoState()
    offerUndo('Demo guild loaded.', previous)
  }

  function startOver() {
    if (confirming !== 'new') {
      confirming = 'new'
      return
    }
    const previous = app.data
    clearState()
    app.view = 'planner'
    app.data = null
    offerUndo('Guild erased.', previous)
  }

  function downloadBackup() {
    const date = todayIso(guild.timezone)
    downloadText(`whentoraid-backup-${date}.json`, backupJson($state.snapshot(app.data)), 'application/json')
  }

  function restore(state) {
    const previous = app.data
    app.data = state
    offerUndo(`Restored ${state.guild.name} from the backup.`, previous)
  }
</script>

<PageTitle
  eyebrow="THE RULES OF YOUR RAID"
  title="Guild settings"
  subtitle="Choose a raid to edit its composition. Guild details apply to all raids."
/>

<RaidSelector />

<form class="panel settings-panel" onsubmit={save}>
  <h2>Guild</h2>
  <div class="settings-grid">
    <label class="field"
      >Guild name<input name="guildName" required maxlength="60" value={guild.name} /></label
    >
    <label class="field">
      Guild timezone
      <select name="timezone">
        {#each zones as zone (zone)}
          <option selected={zone === guild.timezone}>{zone}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      Raids can start from
      <select name="startHour">
        {#each START_HOUR_OPTIONS as hour (hour.value)}
          <option value={hour.value} selected={hour.value === hours.startHour}>{hour.label}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      Raids must end by
      <select name="endHour">
        {#each END_HOUR_OPTIONS as hour (hour.value)}
          <option value={hour.value} selected={hour.value === hours.endHour}>{hour.label}</option>
        {/each}
      </select>
    </label>
  </div>

  <h2>Raid composition</h2>
  <p>Editing {settings.name}. The role slots must add up to the raid size.</p>
  {#key settings.id}
    <CompositionFields raid={settings} />
  {/key}

  <h2>Weekly check-in deadline</h2>
  <p>Shown in the planner and used in “Copy reminder”, so everyone answers before you pick a night.</p>
  <label class="checkbox-row">
    <input type="checkbox" bind:checked={hasDeadline} />
    Ask players to check in by a deadline
  </label>
  {#if hasDeadline}
    <div class="settings-grid">
      <label class="field">
        Deadline day
        <select name="deadlineDay">
          {#each DAYS as dayName, day (dayName)}
            <option value={day} selected={day === deadline.day}>{dayName}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        Deadline time ({guild.timezone})
        <input name="deadlineTime" type="time" required value={minutesToTimeInput(deadline.minutes)} />
      </label>
    </div>
  {/if}

  <h2>Discord access</h2>
  <p>
    Connection not configured. These fields save configuration notes only; this preview does not authenticate
    users.
  </p>
  <div class="settings-grid">
    <label class="field">
      Discord server ID
      <input
        name="discordServerId"
        inputmode="numeric"
        pattern="[0-9]*"
        placeholder="Your Discord server ID"
        value={guild.discordServerId}
      />
    </label>
    <label class="field">
      Officer role IDs (comma-separated)
      <input
        name="officerRoleIds"
        pattern="[0-9, ]*"
        placeholder="Role IDs with planner access"
        value={guild.officerRoleIds}
      />
    </label>
  </div>
  <p class="note">
    The live service must verify server membership and officer roles on the server. A Discord display tag is
    not a reliable access rule.
  </p>
  <button class="primary form-actions">Save settings</button>
</form>

<section class="panel settings-panel spaced-top">
  <h2>Online</h2>
  <OnlineAccount />
</section>

<section class="panel settings-panel spaced-top">
  <h2>Backup</h2>
  {#if remote.guildId}
    <p>Download a copy of this online guild. It can be restored as a guild saved in a browser.</p>
    <div class="buttons">
      <button onclick={downloadBackup}>Download backup (.json)</button>
    </div>
  {:else}
    <p>
      Your guild is saved only in this browser. Download a backup to keep a copy, or to move the guild to
      another browser or device. Restoring replaces the guild here.
    </p>
    <div class="buttons">
      <button onclick={downloadBackup}>Download backup (.json)</button>
      <RestoreButton onrestore={restore} />
    </div>
  {/if}
</section>

{#if !remote.guildId}
  <section class="panel settings-panel spaced-top">
    <h2>Start over</h2>
    <p>Your guild is saved only in this browser. Both options below erase it here.</p>
    <p>
      The demo generates a fresh calendar year of sample availability and plans for all three raids every
      time.
    </p>
    <div class="buttons">
      <button class:danger={confirming === 'demo'} onclick={loadDemo}>
        {confirming === 'demo' ? 'Click again to replace your guild' : 'Replace with the demo guild'}
      </button>
      <button class:danger={confirming === 'new'} onclick={startOver}>
        {confirming === 'new' ? 'Click again to erase this guild' : 'Set up a new guild'}
      </button>
    </div>
  </section>
{/if}
