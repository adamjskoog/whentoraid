<script>
  import MemberDialog from '../components/MemberDialog.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import { app } from '../lib/app.svelte.js'
  import { attendanceRecord, formatRecord, RECORD_LOOKBACK_WEEKS } from '../lib/attendance.js'
  import { CLASS_COLORS } from '../lib/constants.js'
  import { setCurrentMember } from '../lib/members.js'
  import { charactersOf, getCheckin, memberById } from '../lib/model.js'
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
    <button class="primary" onclick={() => (editing = { memberId: null })}>+ Add player</button>
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
            <button disabled={isMe} onclick={() => actAs(member)}>{isMe ? 'Acting as' : 'Act as'}</button>
            <button onclick={() => (editing = { memberId: member.id })} aria-label="Edit {member.name}"
              >Edit</button
            >
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<p class="note">
  Everything is saved in this browser. “Act as” stands in for sign-in until Discord login is connected.
</p>

<MemberDialog open={editing !== null} member={editingMember} onclose={() => (editing = null)} />
