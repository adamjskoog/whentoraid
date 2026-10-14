<script>
  import { tick, untrack } from 'svelte'
  import DiscordChannelSettings from '../components/DiscordChannelSettings.svelte'
  import ReminderSettings from '../components/ReminderSettings.svelte'
  import { discordChannel } from '../lib/discord-channel.svelte.js'
  import OnlineAccount from '../components/OnlineAccount.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import RestoreButton from '../components/RestoreButton.svelte'
  import RaidSelector from '../components/RaidSelector.svelte'
  import CompositionFields from '../components/CompositionFields.svelte'
  import RaidRulesEditor from '../components/RaidRulesEditor.svelte'
  import RaidScheduleEditor from '../components/RaidScheduleEditor.svelte'
  import SectionTabs from '../components/SectionTabs.svelte'
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
  import { setLeaveGuard } from '../lib/leave-guard.js'
  import { tracksAttendance } from '../lib/model.js'
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
  const tabs = [
    { id: 'rules', label: 'Raid rules' },
    { id: 'connections', label: 'Connections' },
    { id: 'backups', label: 'Backups' },
  ]
  let section = $state('rules')
  let rulesPanel

  let hasDeadline = $state(app.data.settings.checkinDeadline !== null)
  /** Both "start over" actions erase the guild, so each takes two clicks: 'demo' | 'new' | null. */
  let confirming = $state(null)

  /** Bumped to throw away unsaved edits: the form renders again from the saved settings. */
  let formVersion = $state(0)
  let form = $state()
  /** The form's values as loaded and as they are now; they differ while there are unsaved edits. */
  let loaded = $state('')
  let current = $state('')
  const dirty = $derived(current !== loaded)

  const formValues = () => (form ? JSON.stringify([...new FormData(form)]) : '')

  // Take the loaded values once the form is bound, and again whenever it is rebuilt: another raid,
  // or edits discarded.
  $effect(() => {
    void form
    void settings.id
    void formVersion
    untrack(() => {
      loaded = current = formValues()
    })
  })

  /** Fields such as the deadline time appear after a toggle re-renders, so read the form after it. */
  async function trackChanges() {
    await tick()
    current = formValues()
  }

  function discardChanges() {
    hasDeadline = app.data.settings.checkinDeadline !== null
    formVersion += 1
  }

  function selectSection(value) {
    section = value
    confirming = null
  }

  async function reviewChanges() {
    selectSection('rules')
    await tick()
    rulesPanel?.focus()
  }

  async function discardEdits() {
    discardChanges()
    await tick()
    rulesPanel?.focus()
  }

  /** Native validation must be able to focus a field inside a collapsed section. */
  function revealInvalidField(event) {
    const details = event.target.closest('details')
    if (details) details.open = true
  }

  $effect(() => setLeaveGuard({ isDirty: () => dirty, discard: discardChanges }))

  function warnBeforeUnload(event) {
    if (!dirty) return
    event.preventDefault()
    event.returnValue = ''
  }

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
      trackAttendance: form.get('trackAttendance') === 'on',
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
  subtitle="Manage your raid rules, connect your guild, and keep a backup."
/>

<svelte:window onbeforeunload={warnBeforeUnload} />

<div class="settings-workspace">
  <SectionTabs
    id="settings"
    label="Guild settings sections"
    {tabs}
    value={section}
    onselect={selectSection}
  />

  {#if dirty && section !== 'rules'}
    <div class="settings-draft" role="status">
      <span>You have unsaved raid rules.</span>
      <button onclick={reviewChanges}>Review changes</button>
    </div>
  {/if}

  <div
    id="settings-panel-rules"
    bind:this={rulesPanel}
    role="tabpanel"
    aria-labelledby="settings-tab-rules"
    tabindex="0"
    hidden={section !== 'rules'}
  >
    <RaidSelector />
    {#if !canManage()}<p class="note settings-readonly">
        Only officers can change guild settings. You can review the current raid rules below.
      </p>{/if}
    {#key formVersion}
      <form
        class="panel settings-panel"
        bind:this={form}
        onsubmit={save}
        oninput={trackChanges}
        onchange={trackChanges}
        oninvalidcapture={revealInvalidField}
      >
        <fieldset class="plain" disabled={!canManage()} aria-label="Guild and raid rules">
          <details class="settings-section" open>
            <summary><h2>Guild</h2></summary>
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
          </details>

          <details class="settings-section" open>
            <summary><h2>Raid composition</h2></summary>
            <p>Editing {settings.name}. The role slots must add up to the raid size.</p>
            {#key settings.id}
              <CompositionFields raid={settings} />
            {/key}
          </details>

          <details class="settings-section">
            <summary><h2>Weekly check-in deadline</h2></summary>
            <p>
              Shown in the planner and used in “Copy reminder”, so everyone answers before you pick a night.
            </p>
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
                  <input
                    name="deadlineTime"
                    type="time"
                    required
                    value={minutesToTimeInput(deadline.minutes)}
                  />
                </label>
              </div>
            {/if}
          </details>

          <details class="settings-section">
            <summary><h2>Attendance</h2></summary>
            <p>
              Record who attended, was late, or did not show after each raid. Records appear on Guild members
              and in each player’s roster details.
            </p>
            <label class="checkbox-row">
              <input type="checkbox" name="trackAttendance" checked={tracksAttendance(app.data)} />
              Track attendance after each raid
            </label>
          </details>

          <details class="settings-section">
            <summary><h2>Discord access</h2></summary>
            <p>
              The server ID lets Confirm and Can’t attend buttons on bot-posted rosters reach this guild. Role
              IDs are notes for future role syncing. Online access uses the Discord ID saved on each guild
              member and the officer setting in this app.
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
            <p class="note">Changing these IDs does not change who can access this guild.</p>
          </details>
        </fieldset>
        <div class="settings-save">
          {#if canManage()}
            <button class="primary form-actions">Save settings</button>
            {#if dirty}<button type="button" onclick={discardEdits}>Discard edits</button>{/if}
            <small role="status">{dirty ? 'Unsaved changes' : 'No pending edits'}</small>
          {:else}
            <small>Viewing saved guild settings.</small>
          {/if}
        </div>
      </form>
    {/key}
    <RaidRulesEditor />
    <RaidScheduleEditor />
  </div>

  <div
    id="settings-panel-connections"
    class="settings-stack"
    role="tabpanel"
    aria-labelledby="settings-tab-connections"
    tabindex="0"
    hidden={section !== 'connections'}
  >
    <section class="panel settings-panel">
      <DiscordChannelSettings />
    </section>

    {#if remote.guildId && canManage() && discordChannel.webhookUrl}
      <section class="panel settings-panel">
        <ReminderSettings />
      </section>
    {/if}

    <section class="panel settings-panel">
      <h2>Online</h2>
      <OnlineAccount />
    </section>
  </div>

  <div
    id="settings-panel-backups"
    class="settings-stack"
    role="tabpanel"
    aria-labelledby="settings-tab-backups"
    tabindex="0"
    hidden={section !== 'backups'}
  >
    <section class="panel settings-panel">
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
      <section class="panel settings-panel settings-reset">
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
          {#if confirming}<button onclick={() => (confirming = null)}>Cancel</button>{/if}
        </div>
      </section>
    {/if}
  </div>
</div>
