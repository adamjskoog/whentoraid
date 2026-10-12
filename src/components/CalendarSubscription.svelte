<script>
  import {
    calendarSubscriptionUrl,
    createCalendarSubscription,
    revokeCalendarSubscription,
  } from '../lib/raid-services.js'
  import { supabase } from '../lib/remote/client.js'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /**
   * A private calendar link with only this player's published raids. Calendar apps re-check it,
   * so new times and cancellations arrive by themselves. The link is shown once: the server keeps
   * only a fingerprint of it, so making a new one turns the old one off.
   */
  let link = $state('')
  let busy = $state(false)

  async function run(action) {
    busy = true
    try {
      await action()
    } catch (error) {
      showToast(error.message)
    } finally {
      busy = false
    }
  }

  const create = () =>
    run(async () => {
      const token = await createCalendarSubscription(supabase, remote.guildId)
      link = calendarSubscriptionUrl(import.meta.env.VITE_SUPABASE_URL, token)
    })

  const revoke = () =>
    run(async () => {
      await revokeCalendarSubscription(supabase, remote.guildId)
      link = ''
      showToast('Calendar link turned off. Calendars using it stop updating.')
    })

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      showToast('Calendar link copied.')
    } catch {
      showToast('Select the link and copy it.')
    }
  }
</script>

<section class="panel" aria-label="Calendar link">
  <h2>Add your raids to your calendar</h2>
  <p>
    A private link for Google Calendar, Apple Calendar or Outlook (“subscribe from URL”). It lists only your
    published raids and updates when officers change them.
  </p>
  {#if link}
    <label class="field">
      Your calendar link
      <input readonly value={link} onfocus={(e) => e.currentTarget.select()} />
    </label>
    <p class="note">Keep it to yourself: anyone with the link can see your raid times.</p>
    <div class="buttons">
      <button class="primary" onclick={copy}>Copy link</button>
      <button disabled={busy} onclick={revoke}>Turn off link</button>
    </div>
  {:else}
    <div class="buttons">
      <button disabled={busy} onclick={create}>Create calendar link</button>
      <button disabled={busy} onclick={revoke}>Turn off my old link</button>
    </div>
    <p class="note">Creating a new link turns off any link you made before.</p>
  {/if}
</section>
