<script>
  import PageTitle from '../components/PageTitle.svelte'
  import { app } from '../lib/app.svelte.js'
  import { DAYS, DURATION_OPTIONS, MAX_RAID_SIZE, ROLES } from '../lib/constants.js'
  import { HOUR_OPTIONS } from '../lib/forms.js'
  import {
    DEFAULT_CHECKIN_DEADLINE,
    minutesToTimeInput,
    raidHours,
    timeInputToMinutes,
    timeZoneOptions,
  } from '../lib/guild.js'
  import { applySettings } from '../lib/planning.js'
  import { createSeedState } from '../lib/seed.js'
  import { clearState } from '../lib/storage.js'
  import { showToast } from '../lib/toast.svelte.js'

  const settings = $derived(app.data.settings)
  const guild = $derived(app.data.guild)
  const hours = $derived(raidHours(guild))
  const zones = $derived(timeZoneOptions(guild.timezone))
  const deadline = $derived(settings.checkinDeadline ?? DEFAULT_CHECKIN_DEADLINE)

  let hasDeadline = $state(app.data.settings.checkinDeadline !== null)
  /** Both "start over" actions erase the guild, so each takes two clicks: 'demo' | 'new' | null. */
  let confirming = $state(null)

  function durationLabel(slots) {
    const hoursLong = slots / 2
    return `${hoursLong} ${hoursLong === 1 ? 'hour' : 'hours'}`
  }

  function save(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const result = applySettings(app.data, {
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
    showToast('Settings saved; roster rebuilt')
    app.view = 'planner'
  }

  function loadDemo() {
    if (confirming !== 'demo') {
      confirming = 'demo'
      return
    }
    app.view = 'planner'
    app.data = createSeedState()
    showToast('Demo guild loaded')
  }

  function startOver() {
    if (confirming !== 'new') {
      confirming = 'new'
      return
    }
    clearState()
    app.view = 'planner'
    app.data = null
  }
</script>

<PageTitle
  eyebrow="THE RULES OF YOUR RAID"
  title="Guild settings"
  subtitle="Set the raid requirements used by every suggestion."
/>

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
        {#each HOUR_OPTIONS.slice(0, -1) as hour (hour.value)}
          <option value={hour.value} selected={hour.value === hours.startHour}>{hour.label}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      Raids must end by
      <select name="endHour">
        {#each HOUR_OPTIONS.slice(1) as hour (hour.value)}
          <option value={hour.value} selected={hour.value === hours.endHour}>{hour.label}</option>
        {/each}
      </select>
    </label>
  </div>

  <h2>Raid composition</h2>
  <div class="settings-grid">
    {#each ROLES as role, i (role)}
      <label class="field">
        {role} slots
        <input
          name="role{i}"
          type="number"
          min="0"
          max={MAX_RAID_SIZE}
          required
          value={settings.targets[i]}
        />
      </label>
    {/each}
    <label class="field">
      Raid duration
      <select name="duration">
        {#each DURATION_OPTIONS as slots (slots)}
          <option value={slots} selected={settings.durationSlots === slots}>{durationLabel(slots)}</option>
        {/each}
      </select>
    </label>
  </div>

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
  <h2>Start over</h2>
  <p>Your guild is saved only in this browser. Both options below erase it here.</p>
  <div class="buttons">
    <button class:danger={confirming === 'demo'} onclick={loadDemo}>
      {confirming === 'demo' ? 'Click again to replace your guild' : 'Replace with the demo guild'}
    </button>
    <button class:danger={confirming === 'new'} onclick={startOver}>
      {confirming === 'new' ? 'Click again to erase this guild' : 'Set up a new guild'}
    </button>
  </div>
</section>
