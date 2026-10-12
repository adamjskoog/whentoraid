<script>
  import { getReminderSettings, setReminderSettings } from '../lib/raid-services.js'
  import { supabase } from '../lib/remote/client.js'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /**
   * Officers of an online guild: automatic Discord reminders, off until switched on. Only players
   * who still need to act are named, and each reminder is sent once.
   */
  const INTERVALS = [
    [6, 'Every 6 hours'],
    [12, 'Every 12 hours'],
    [24, 'Once a day'],
    [48, 'Every 2 days'],
    [72, 'Every 3 days'],
    [168, 'Once a week'],
  ]
  const MAX_LEAD_HOURS = 72

  let settings = $state(null)
  let saved = $state(null)
  let error = $state('')
  let busy = $state(false)

  $effect(() => {
    const guildId = remote.guildId
    getReminderSettings(supabase, guildId)
      .then((value) => {
        if (guildId !== remote.guildId) return
        settings = { ...value }
        saved = { ...value }
      })
      .catch((e) => (error = e.message))
  })

  const changed = $derived(settings && JSON.stringify(settings) !== JSON.stringify(saved))

  async function save(event) {
    event.preventDefault()
    const lead = Math.round(Number(settings.lead_hours))
    if (!(lead >= 1 && lead <= MAX_LEAD_HOURS)) {
      showToast(`Choose between 1 and ${MAX_LEAD_HOURS} hours before the raid.`)
      return
    }
    busy = true
    try {
      const next = { ...settings, lead_hours: lead }
      await setReminderSettings(supabase, remote.guildId, next)
      settings = { ...next }
      saved = { ...next }
      showToast('Reminder settings saved.')
    } catch (e) {
      showToast(e.message)
    } finally {
      busy = false
    }
  }
</script>

<h2>Discord reminders</h2>
<p>Post a nudge in your Discord channel that names only the players who still need to act.</p>
{#if error}
  <p class="warning">{error}</p>
{:else if !settings}
  <p class="note">Loading…</p>
{:else}
  <form onsubmit={save}>
    <label class="checkbox-row">
      <input type="checkbox" bind:checked={settings.checkin_enabled} />
      Remind players who haven’t checked in this week
    </label>
    {#if settings.checkin_enabled}
      <label class="field">
        How often
        <select bind:value={settings.interval_hours}>
          {#each INTERVALS as [hours, label] (hours)}<option value={hours}>{label}</option>{/each}
        </select>
      </label>
      <p class="note">Stops at the check-in deadline.</p>
    {/if}
    <label class="checkbox-row">
      <input type="checkbox" bind:checked={settings.upcoming_enabled} />
      Remind rostered players before a published raid
    </label>
    {#if settings.upcoming_enabled}
      <label class="field">
        Hours before the raid
        <input type="number" min="1" max={MAX_LEAD_HOURS} bind:value={settings.lead_hours} />
      </label>
      <label class="checkbox-row">
        <input type="checkbox" bind:checked={settings.only_unconfirmed} />
        Only players who haven’t confirmed yet
      </label>
      <p class="note">Players who said they can’t make it are never reminded.</p>
    {/if}
    <div class="buttons">
      <button class="primary" disabled={busy || !changed}>Save reminders</button>
    </div>
  </form>
{/if}
