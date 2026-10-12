<script>
  import { discordChannel, loadDiscordChannel, saveDiscordChannel } from '../lib/discord-channel.svelte.js'
  import { postToWebhook } from '../lib/discord-webhook.js'
  import { escapeDiscord } from '../lib/roster-export.js'
  import { app } from '../lib/app.svelte.js'
  import { canManage, remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /** Where officers connect a Discord channel, so published rosters can be posted there. */
  let busy = $state(false)
  let webhookUrl = $state('')
  let mentionPlayers = $state(false)

  $effect(() => {
    if (canManage()) void loadDiscordChannel()
  })

  // Show the saved values whenever they (re)load.
  $effect(() => {
    if (!discordChannel.loaded) return
    webhookUrl = discordChannel.webhookUrl
    mentionPlayers = discordChannel.mentionPlayers
  })

  async function run(action, done) {
    busy = true
    try {
      await action()
      showToast(done)
    } catch (error) {
      showToast(error.message)
    } finally {
      busy = false
    }
  }

  function save(event) {
    event.preventDefault()
    run(
      () => saveDiscordChannel({ webhookUrl, mentionPlayers }),
      webhookUrl.trim() ? 'Discord channel saved.' : 'Discord channel removed.',
    )
  }

  function remove() {
    run(() => saveDiscordChannel({ webhookUrl: '', mentionPlayers: false }), 'Discord channel removed.')
  }

  const sendTest = () =>
    run(
      () =>
        postToWebhook(discordChannel.webhookUrl, [
          `WhenToRaid is connected. Rosters for **${escapeDiscord(app.data.guild.name)}** will be posted here.`,
        ]),
      'Test message sent. Check the channel in Discord.',
    )

  const saved = $derived(discordChannel.webhookUrl !== '')
  const changed = $derived(
    webhookUrl.trim() !== discordChannel.webhookUrl || mentionPlayers !== discordChannel.mentionPlayers,
  )
</script>

<h2>Discord channel</h2>
<p>
  Post published rosters straight to a Discord channel. Posting again edits the same message, so the channel
  keeps one roster per raid.
</p>
{#if !canManage()}
  <p class="note">Only officers can connect a Discord channel.</p>
{:else if discordChannel.error}
  <p class="warning">{discordChannel.error}</p>
{:else if !discordChannel.loaded}
  <p class="note">Loading…</p>
{:else}
  <details class="note">
    <summary>How to get a webhook URL</summary>
    <ol>
      <li>In Discord, open the channel’s settings (the gear next to its name), then <b>Integrations</b>.</li>
      <li><b>Webhooks</b>, then <b>New Webhook</b>. Name it, for example “WhenToRaid”.</li>
      <li>Click <b>Copy Webhook URL</b> and paste it below.</li>
    </ol>
    <p>You need the Manage Webhooks permission on the server.</p>
  </details>
  <form onsubmit={save}>
    <label class="field">
      Webhook URL
      <input
        type="url"
        name="webhookUrl"
        autocomplete="off"
        spellcheck="false"
        placeholder="https://discord.com/api/webhooks/…"
        bind:value={webhookUrl}
      />
    </label>
    <label class="checkbox-row">
      <input type="checkbox" bind:checked={mentionPlayers} />
      Mention rostered players who have a Discord ID when a roster is first posted
    </label>
    <p class="note">
      Anyone with this URL can post in the channel, so only officers see it{remote.guildId
        ? ''
        : '. It is saved in this browser only, not in backups'}.
    </p>
    <div class="buttons">
      <button class="primary" disabled={busy || !changed}>Save channel</button>
      {#if saved}
        <button type="button" disabled={busy || changed} onclick={sendTest}>Send test message</button>
        <button type="button" disabled={busy} onclick={remove}>Remove channel</button>
      {/if}
    </div>
  </form>
{/if}
