<script>
  import { app } from '../lib/app.svelte.js'
  import { discordChannel } from '../lib/discord-channel.svelte.js'
  import { sendQueued } from '../lib/discord-delivery.svelte.js'
  import { getSignupPost, listRaidSignups, queueSignupPost } from '../lib/raid-services.js'
  import { supabase } from '../lib/remote/client.js'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /**
   * Online guilds: who answered this raid's Discord sign-up post, and (officers) posting it.
   * A sign-up also fills in the player's availability, so the planner already counts it; this
   * panel shows the answers themselves, including late arrivals and changes after the deadline.
   */
  let { week, raidId, canManage } = $props()

  let signups = $state({ key: null, rows: [], error: '' })
  let post = $state(null)
  let busy = $state(false)

  const key = $derived(JSON.stringify([remote.guildId, week, raidId]))
  // A sign-up changes the player's check-in, so a live reload of this week's check-ins means
  // there may be new answers to show.
  const weekCheckins = $derived(app.data.weeks?.[week]?.checkins)

  async function loadPost() {
    if (!canManage) return
    const rows = await getSignupPost(supabase, remote.guildId, week, raidId)
    post = rows?.[0] ?? null
  }

  $effect(() => {
    const current = key
    void weekCheckins
    listRaidSignups(supabase, remote.guildId, week)
      .then((rows) => {
        if (current === key) signups = { key: current, rows: rows ?? [], error: '' }
      })
      .catch((error) => {
        if (current === key) signups = { ...signups, error: error.message }
      })
    loadPost().catch(() => (post = null))
  })

  const rows = $derived(signups.rows.filter((row) => row.raid_id === raidId))
  const coming = $derived(rows.filter((row) => row.status === 'signed' || row.status === 'late'))
  const tentative = $derived(rows.filter((row) => row.status === 'tentative'))
  const absent = $derived(rows.filter((row) => row.status === 'absent'))

  const memberName = (row) => app.data.members.find((m) => m.id === row.member_id)?.name ?? 'Removed player'
  function characterLabel(row) {
    const character = app.data.characters.find((c) => c.id === row.character_id)
    if (!character) return ''
    const build = [character.spec, character.class].filter(Boolean).join(' ')
    return build ? `${character.name} (${build})` : character.name
  }
  function describe(row) {
    return [memberName(row), characterLabel(row), row.status === 'late' ? 'late' : '']
      .concat(row.after_deadline ? 'after the deadline' : '')
      .filter(Boolean)
      .join(' · ')
  }

  const hasBot = $derived(Boolean(discordChannel.channelId))
  const postStatus = $derived(
    !post
      ? 'Not posted in Discord yet.'
      : post.status === 'failed' || post.status === 'uncertain'
        ? `The Discord post needs attention: ${post.last_error ?? 'it could not be sent.'}`
        : post.status === 'sent' && post.posted
          ? 'Posted in Discord. It updates as players answer.'
          : 'Queued for Discord…',
  )

  async function postSignup() {
    busy = true
    try {
      await queueSignupPost(supabase, remote.guildId, week, raidId)
      showToast((await sendQueued(week, raidId)) ?? 'Sign-up queued for Discord.')
    } catch (error) {
      showToast(error.message)
    } finally {
      busy = false
      await loadPost().catch(() => {})
    }
  }
</script>

<section class="panel spaced-top" aria-label="Discord sign-ups">
  <h2>Discord sign-ups</h2>
  {#if signups.error}
    <p class="warning">Sign-ups could not be loaded: {signups.error}</p>
  {:else if signups.key !== key}
    <p role="status">Loading sign-ups…</p>
  {:else}
    <p>{coming.length} coming · {tentative.length} tentative · {absent.length} absent</p>
    {#if coming.length}
      <ul aria-label="Coming">
        {#each coming as row (row.member_id)}<li>{describe(row)}</li>{/each}
      </ul>
    {/if}
    {#if tentative.length}
      <h3>Tentative</h3>
      <ul aria-label="Tentative">
        {#each tentative as row (row.member_id)}<li>{describe(row)}</li>{/each}
      </ul>
    {/if}
    {#if absent.length}
      <h3>Absent</h3>
      <ul aria-label="Absent">
        {#each absent as row (row.member_id)}<li>{describe(row)}</li>{/each}
      </ul>
    {/if}
  {/if}

  {#if canManage}
    {#if hasBot}
      <p class="note" role="status">{postStatus}</p>
      <div class="buttons">
        <button disabled={busy} onclick={postSignup}
          >{post?.posted ? 'Update sign-up post' : 'Post sign-up in Discord'}</button
        >
      </div>
    {:else}
      <p class="note">
        Sign-up posts need the WhenToRaid bot. Add it and choose its channel in Guild settings → Discord.
      </p>
    {/if}
  {/if}
</section>

<style>
  ul {
    padding-left: 1.25rem;
  }
  h3 {
    margin-bottom: 0.25rem;
  }
</style>
