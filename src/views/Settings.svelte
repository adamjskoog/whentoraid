<script>
  import PageTitle from '../components/PageTitle.svelte'
  import { app } from '../lib/app.svelte.js'
  import { DURATION_OPTIONS, MAX_RAID_SIZE, ROLES } from '../lib/constants.js'
  import { applySettings } from '../lib/planning.js'
  import { showToast } from '../lib/toast.svelte.js'

  const settings = $derived(app.data.settings)
  const guild = $derived(app.data.guild)

  function durationLabel(slots) {
    const hours = slots / 2
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }

  function save(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const result = applySettings(app.data, {
      targets: ROLES.map((_, i) => Number(form.get(`role${i}`))),
      durationSlots: Number(form.get('duration')),
      discordServerId: String(form.get('discordServerId') ?? '').trim(),
      officerRoleIds: String(form.get('officerRoleIds') ?? '').trim(),
    })
    if (result.error) {
      showToast(result.error)
      return
    }
    app.data = result.state
    showToast('Requirements saved; roster rebuilt')
    app.view = 'planner'
  }
</script>

<PageTitle
  eyebrow="THE RULES OF YOUR RAID"
  title="Guild settings"
  subtitle="Set the raid requirements used by every suggestion."
/>

<form class="panel settings-panel" onsubmit={save}>
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
  <button class="primary form-actions">Save requirements</button>
</form>
