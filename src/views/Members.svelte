<script>
  import MemberDialog from '../components/MemberDialog.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import { app } from '../lib/app.svelte.js'
  import { attendanceRecord, formatRecord, RECORD_LOOKBACK_WEEKS } from '../lib/attendance.js'
  import { CLASS_COLORS } from '../lib/constants.js'
  import { setCurrentMember } from '../lib/members.js'
  import { charactersOf, getCheckin, memberById } from '../lib/model.js'
  import { canManage, remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /** null: closed. { memberId: null }: adding. { memberId }: editing. */
  let editing = $state(null)
  const editingMember = $derived(editing?.memberId ? memberById(app.data, editing.memberId) : null)

  const weekIso = $derived(app.data.currentWeek)
  const rows = $derived(
    app.data.members.map((member) => {
      const mine = charactersOf(app.data, member.id)
      return {
        member,
        main: mine.find((c) => c.main) ?? mine[0],
        alts: Math.max(0, mine.length - 1),
        status: weekStatus(getCheckin(app.data, weekIso, member.id)),
        record: formatRecord(attendanceRecord(app.data, weekIso, member.id)),
      }
    }),
  )

  function weekStatus(checkin) {
    if (!checkin.checkedIn) return { label: 'Waiting', tone: 'gold' }
    if (checkin.ranges.length === 0) return { label: 'Can’t make it', tone: 'muted' }
    return { label: 'Checked in', tone: 'ok' }
  }

  function actAs(member) {
    app.data = setCurrentMember(app.data, member.id)
    showToast(`Now acting as ${member.name}. Their availability and characters are in the menu.`)
  }
</script>

<PageTitle
  eyebrow="EVERYONE WHO RAIDS WITH YOU"
  title="Guild members"
  subtitle="Add your players, then act as any of them to fill in their availability and characters."
>
  {#snippet action()}
    {#if canManage()}
      <button class="primary" onclick={() => (editing = { memberId: null })}>+ Add player</button>
    {/if}
  {/snippet}
</PageTitle>

<div class="panel member-table-wrap">
  <table class="member-table">
    <thead>
      <tr>
        <th scope="col">Player</th>
        <th scope="col">Main character</th>
        <th scope="col">This week</th>
        <th scope="col">Attendance (last {RECORD_LOOKBACK_WEEKS} weeks)</th>
        <th scope="col"><span class="visually-hidden">Actions</span></th>
      </tr>
    </thead>
    <tbody>
      {#each rows as { member, main, alts, status, record } (member.id)}
        {@const isMe = member.id === app.data.currentMemberId}
        <tr>
          <th scope="row">
            {member.name}
            {#if isMe}<span class="badge">YOU</span>{/if}
            {#if remote.guildId && member.officer}<span class="badge">OFFICER</span>{/if}
            <small>{member.discordId ? 'Discord ID saved' : 'No Discord ID'}</small>
          </th>
          <td style:--class={main ? CLASS_COLORS[main.class] : null}>
            {#if main}
              <strong class="class-name">{main.name}</strong>
              <small
                >{main.spec}
                {main.class} · {main.role}{alts ? ` · +${alts} alt${alts === 1 ? '' : 's'}` : ''}</small
              >
            {/if}
          </td>
          <td data-label="This week"><span class={status.tone}>{status.label}</span></td>
          <td data-label="Attendance">{record ?? '—'}</td>
          <td class="row-actions">
            {#if canManage()}
              <button disabled={isMe} onclick={() => actAs(member)}>{isMe ? 'Acting as' : 'Act as'}</button>
              <button onclick={() => (editing = { memberId: member.id })} aria-label="Edit {member.name}"
                >Edit</button
              >
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<p class="note">
  {#if !remote.guildId}
    Everything is saved in this browser. “Act as” stands in for sign-in until your guild is online.
  {:else if canManage()}
    Players sign in with Discord: add a player’s Discord ID to let them in. As an officer you can act as
    anyone to fill in their availability.
  {:else}
    Officers manage the player list. You can edit your own availability and characters.
  {/if}
</p>

<MemberDialog open={editing !== null} member={editingMember} onclose={() => (editing = null)} />
