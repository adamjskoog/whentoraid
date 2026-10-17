<script>
  import { untrack } from 'svelte'
  import { discordChannel, loadDiscordChannel, saveDiscordChannel } from '../lib/discord-channel.svelte.js'
  import {
    finishDiscordConnect,
    hasDiscordReturn,
    listDiscordChannels,
    startDiscordConnect,
  } from '../lib/discord-connect.js'
  import { supabase } from '../lib/remote/client.js'
  import { postToWebhook } from '../lib/discord-webhook.js'
  import { escapeDiscord } from '../lib/roster-export.js'
  import { app } from '../lib/app.svelte.js'
  import { canManage, remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /** Where officers connect a Discord channel, so published rosters can be posted there. */
  let busy = $state(false)
  let webhookUrl = $state('')
  let channelId = $state('')
  let mentionPlayers = $state(false)

  $effect(() => {
    if (canManage()) void loadDiscordChannel()
  })

  // Show the saved values whenever they (re)load.
  $effect(() => {
    if (!discordChannel.loaded) return
    webhookUrl = discordChannel.webhookUrl
    channelId = discordChannel.channelId
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
      () => saveDiscordChannel({ webhookUrl, mentionPlayers, channelId }),
      webhookUrl.trim() || channelId.trim() ? 'Discord channel saved.' : 'Discord channel removed.',
    )
  }

  function remove() {
    run(
      () => saveDiscordChannel({ webhookUrl: '', mentionPlayers: false, channelId: '' }),
      'Discord channel removed.',
    )
  }

  // The bot (online guilds): added to a server on Discord's own screen, then given a channel from a list.
  /** @type {{ id: string, name: string, category: string, canPost: boolean, canEmbed?: boolean }[]} */
  let channels = $state([])
  let channelsError = $state(null)
  let channelsLoading = $state(false)

  async function loadChannels() {
    const guildId = remote.guildId
    channelsLoading = true
    channelsError = null
    try {
      const list = await listDiscordChannels(supabase, guildId)
      if (remote.guildId === guildId) channels = list
    } catch (error) {
      if (remote.guildId === guildId) channelsError = error.message
    } finally {
      channelsLoading = false
    }
  }

  $effect(() => {
    if (canManage() && remote.guildId && discordChannel.loaded && discordChannel.serverId)
      untrack(loadChannels)
  })

  // Back from Discord's "add to server" screen: confirm the server, then offer its channels.
  $effect(() => {
    const guildId = remote.guildId
    if (!guildId || !canManage() || !hasDiscordReturn()) return
    untrack(async () => {
      busy = true
      try {
        const linked = await finishDiscordConnect(supabase, guildId)
        if (!linked) return
        await loadDiscordChannel({ force: true })
        showToast(
          `WhenToRaid joined ${linked.serverName || 'your Discord server'}. Choose its channel below.`,
        )
      } catch (error) {
        showToast(error.message)
      } finally {
        busy = false
      }
    })
  })

  const connect = () => run(() => startDiscordConnect(supabase, remote.guildId), 'Opening Discord…')

  /** The channels to choose from, keeping a saved channel the list no longer shows. */
  const channelOptions = $derived(
    discordChannel.channelId && !channels.some((c) => c.id === discordChannel.channelId)
      ? [{ id: discordChannel.channelId, name: 'saved channel', category: '', canPost: true }, ...channels]
      : channels,
  )

  // `canEmbed` is false only when the list says so; an older server function leaves it out.
  const noCards = (channel) => channel.canPost && channel.canEmbed === false
  const chosenWithoutCards = $derived(channels.find((c) => c.id === channelId && noCards(c)))
  function channelLabel(channel) {
    const where = `#${channel.name}${channel.category ? ` · ${channel.category}` : ''}`
    if (!channel.canPost) return `${where} (bot can’t post here)`
    return noCards(channel) ? `${where} (no Embed Links: sign-up cards won’t show)` : where
  }

  const sendTest = () =>
    run(
      () =>
        postToWebhook(discordChannel.webhookUrl, [
          `WhenToRaid is connected. Rosters for **${escapeDiscord(app.data.guild.name)}** will be posted here.`,
        ]),
      'Test message sent. Check the channel in Discord.',
    )

  const saved = $derived(discordChannel.webhookUrl !== '' || discordChannel.channelId !== '')
  const changed = $derived(
    webhookUrl.trim() !== discordChannel.webhookUrl ||
      channelId.trim() !== discordChannel.channelId ||
      mentionPlayers !== discordChannel.mentionPlayers,
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
  <form onsubmit={save}>
    {#if remote.guildId}
      <div class="bot-connect">
        <h3>WhenToRaid bot</h3>
        {#if discordChannel.serverId}
          <p>
            Added to <b>{discordChannel.serverName || 'your Discord server'}</b>. Rosters the bot posts have
            Confirm and Can’t attend buttons.
          </p>
          <label class="field">
            Bot channel
            <select name="channelId" bind:value={channelId} disabled={busy || channelsLoading}>
              <option value="">None (use the webhook below)</option>
              {#each channelOptions as channel (channel.id)}
                <option value={channel.id} disabled={!channel.canPost && channel.id !== channelId}>
                  {channelLabel(channel)}
                </option>
              {/each}
            </select>
          </label>
          {#if channelsError}
            <p class="warning">{channelsError}</p>
          {/if}
          {#if chosenWithoutCards}
            <p class="warning" role="status">
              The bot can post rosters in #{chosenWithoutCards.name}, but it can’t show sign-up cards there.
              In Discord, give the WhenToRaid bot (or its role) Embed Links in that channel, then refresh the
              channels.
            </p>
          {/if}
          <p class="note">
            Missing a channel, or the bot can’t post there? Give the WhenToRaid bot View Channel and Send
            Messages in that channel’s permissions, then refresh the list. Sign-up posts also need Embed
            Links.
          </p>
          <div class="buttons">
            <button type="button" disabled={busy || channelsLoading} onclick={loadChannels}
              >Refresh channels</button
            >
            <button type="button" disabled={busy} onclick={connect}>Add to a different server</button>
          </div>
        {:else}
          <p>
            Add the bot to your Discord server, then pick its channel here. Rosters it posts get Confirm and
            Can’t attend buttons. You need the Manage Server permission on the server.
          </p>
          <button type="button" class="primary" disabled={busy} onclick={connect}
            >Add WhenToRaid to Discord</button
          >
        {/if}
      </div>
      <h3>Or post with a webhook</h3>
    {/if}
    <details class="note">
      <summary>How to get a webhook URL</summary>
      <ol>
        <li>
          In Discord, open the channel’s settings (the gear next to its name), then <b>Integrations</b>.
        </li>
        <li><b>Webhooks</b>, then <b>New Webhook</b>. Name it, for example “WhenToRaid”.</li>
        <li>Click <b>Copy Webhook URL</b> and paste it below.</li>
      </ol>
      <p>You need the Manage Webhooks permission on the server.</p>
    </details>
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
    {#if remote.guildId && channelId}
      <p class="note">The bot channel is used while one is chosen; the webhook is kept for later.</p>
    {/if}
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
        {#if discordChannel.webhookUrl}<button type="button" disabled={busy || changed} onclick={sendTest}
            >Send test message</button
          >{/if}
        <button type="button" disabled={busy} onclick={remove}>Remove channel</button>
      {/if}
    </div>
  </form>
{/if}

<style>
  .bot-connect {
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--line);
  }
</style>
