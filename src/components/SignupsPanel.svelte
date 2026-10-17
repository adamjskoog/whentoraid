<script>
  import { app } from '../lib/app.svelte.js'
  import { discordChannel } from '../lib/discord-channel.svelte.js'
  import { sendQueued } from '../lib/discord-delivery.svelte.js'
  import { getSignupPost, listRaidSignups, queueSignupPost } from '../lib/raid-services.js'
  import { supabase } from '../lib/remote/client.js'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'
  import { signupLineup } from '../../supabase/functions/_shared/signup-lineup.js'

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

  const characterOf = (row) => app.data.characters.find((c) => c.id === row.character_id)
  const targets = $derived(app.data.settings?.raids?.find((raid) => raid.id === raidId)?.targets ?? [])
  // The same placement as the Discord post: roles fill in sign-up order, the rest wait on the bench.
  const lineup = $derived(
    signupLineup(
      signups.rows
        .filter((row) => row.raid_id === raidId)
        .map((row) => ({ ...row, role: row.role ?? characterOf(row)?.role ?? null })),
      targets,
    ),
  )
  const coming = $derived(
    [...lineup.roles.flatMap((group) => group.members), ...lineup.other].sort((a, b) => a.number - b.number),
  )
  const roleCounts = $derived(
    lineup.roles
      .map(({ role, target, members }) => `${role} ${members.length}${target ? `/${target}` : ''}`)
      .join(' · '),
  )

  const memberName = (row) => app.data.members.find((m) => m.id === row.member_id)?.name ?? 'Removed player'
  function characterLabel(row) {
    const character = characterOf(row)
    if (!character) return ''
    // A spec chosen for this raid at sign-up comes with the row.
    const build = [row.spec ?? character.spec, character.class].filter(Boolean).join(' ')
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
    <p>
      {coming.length} coming{lineup.bench.length ? ` · ${lineup.bench.length} on the bench` : ''} · {lineup
        .tentative.length} tentative · {lineup.absent.length} absent
    </p>
    {#if lineup.coming}<p class="note">{roleCounts}</p>{/if}
    {#if coming.length}
      <ol aria-label="Coming">
        {#each coming as row (row.member_id)}<li value={row.number}>{describe(row)}</li>{/each}
      </ol>
    {/if}
    {#if lineup.bench.length}
      <h3>Bench</h3>
      <p class="note">Signed up after their role was full. Choose who plays in the roster builder.</p>
      <ol aria-label="Bench">
        {#each lineup.bench as row (row.member_id)}<li value={row.number}>{describe(row)}</li>{/each}
      </ol>
    {/if}
    {#if lineup.tentative.length}
      <h3>Tentative</h3>
      <ul aria-label="Tentative">
        {#each lineup.tentative as row (row.member_id)}<li>{describe(row)}</li>{/each}
      </ul>
    {/if}
    {#if lineup.absent.length}
      <h3>Absent</h3>
      <ul aria-label="Absent">
        {#each lineup.absent as row (row.member_id)}<li>{describe(row)}</li>{/each}
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
  ul,
  ol {
    padding-left: 1.25rem;
  }
  h3 {
    margin-bottom: 0.25rem;
  }
</style>
