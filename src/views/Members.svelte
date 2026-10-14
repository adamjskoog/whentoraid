<script>
  import InvitePanel from '../components/InvitePanel.svelte'
  import MemberDialog from '../components/MemberDialog.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import Icon from '../components/Icon.svelte'
  import { app } from '../lib/app.svelte.js'
  import { attendanceRecord, formatRecord, RECORD_LOOKBACK_WEEKS } from '../lib/attendance.js'
  import { CLASS_COLORS, ROLES } from '../lib/constants.js'
  import { availabilitySource } from '../lib/personal-raids.js'
  import { setCurrentMember } from '../lib/members.js'
  import { charactersOf, getCheckin, memberById, setCurrentWeek, tracksAttendance } from '../lib/model.js'
  import { canManage, remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /** null: closed. { memberId: null }: adding. { memberId }: editing. */
  let editing = $state(null)
  let search = $state('')
  let searchInput
  let roleFilter = $state('')
  let responseFilter = $state('')
  const editingMember = $derived(editing?.memberId ? memberById(app.data, editing.memberId) : null)

  const weekIso = $derived(app.data.currentWeek)
  const showAttendance = $derived(tracksAttendance(app.data))
  const rows = $derived(
    app.data.members.map((member) => {
      const mine = charactersOf(app.data, member.id)
      return {
        member,
        characters: mine,
        main: mine.find((c) => c.main) ?? mine[0],
        alts: Math.max(0, mine.length - 1),
        status: weekStatus(getCheckin(app.data, weekIso, member.id)),
        source: availabilitySource(app.data, weekIso, member.id),
        record: formatRecord(attendanceRecord(app.data, weekIso, member.id)),
      }
    }),
  )
  const filteredRows = $derived(
    rows.filter((row) => {
      const query = search.trim().toLocaleLowerCase()
      return (
        (!query ||
          [row.member.name, ...row.characters.map((character) => character.name)].some((name) =>
            name.toLocaleLowerCase().includes(query),
          )) &&
        (!roleFilter || row.characters.some((character) => character.role === roleFilter)) &&
        (!responseFilter ||
          row.status.key === responseFilter ||
          (responseFilter === 'usual' && row.source === 'Using usual schedule'))
      )
    }),
  )
  const hasFilters = $derived(Boolean(search || roleFilter || responseFilter))
  const checkedIn = $derived(rows.filter((row) => row.status.key !== 'waiting').length)

  function clearFilters() {
    search = ''
    roleFilter = ''
    responseFilter = ''
    searchInput?.focus()
  }

  function changeWeek(event) {
    app.data = setCurrentWeek(app.data, event.currentTarget.value)
    event.currentTarget.value = app.data.currentWeek
  }

  function weekStatus(checkin) {
    if (!checkin.checkedIn) return { key: 'waiting', label: 'Waiting', tone: 'gold' }
    if (checkin.ranges.length === 0) return { key: 'unavailable', label: 'Can’t make it', tone: 'muted' }
    return { key: 'available', label: 'Checked in', tone: 'ok' }
  }

  function actAs(member) {
    app.data = setCurrentMember(app.data, member.id)
    showToast(`Now acting as ${member.name}. Their availability and characters are in the menu.`)
  }
</script>

<PageTitle
  eyebrow="EVERYONE WHO RAIDS WITH YOU"
  title="Guild members"
  subtitle={canManage()
    ? 'Add players and help them keep their availability and characters up to date.'
    : 'Find your guildmates and see who has checked in this week.'}
>
  {#snippet action()}
    {#if canManage()}
      <button class="primary member-add" onclick={() => (editing = { memberId: null })}>+ Add player</button>
    {/if}
  {/snippet}
</PageTitle>

{#if remote.guildId && remote.officer}
  <details class="member-invites">
    <summary
      ><Icon name="members" size={18} /> Invite players <span>Share a guild or personal invite</span></summary
    >
    <InvitePanel />
  </details>
{/if}

<section class="panel member-directory" aria-label="Guild directory">
  <div class="member-context">
    <div>
      <h2>Weekly check-ins</h2>
      <p>
        {checkedIn} of {rows.length} players checked in <span aria-hidden="true">·</span>
        {rows.length - checkedIn} waiting
      </p>
    </div>
    <label class="field">Week beginning<input type="date" value={weekIso} onchange={changeWeek} /></label>
  </div>
  <div class="member-filters" role="search" aria-label="Find guild members">
    <label class="field"
      >Search players or characters<span class="member-search"
        ><Icon name="search" size={18} /><input
          type="search"
          placeholder="Player or character name"
          bind:this={searchInput}
          bind:value={search}
        /></span
      ></label
    >
    <label class="field"
      >Role<select bind:value={roleFilter}
        ><option value="">All roles</option>{#each ROLES as role (role)}<option value={role}>{role}</option
          >{/each}</select
      ></label
    >
    <label class="field"
      >Check-in<select bind:value={responseFilter}
        ><option value="">All responses</option><option value="waiting">Missing check-in</option><option
          value="available">Available</option
        ><option value="unavailable">Can’t make it</option><option value="usual">Using usual schedule</option
        ></select
      ></label
    >
  </div>
  <div class="member-results">
    <p role="status">
      {filteredRows.length} of {rows.length} players{hasFilters ? ' match your filters' : ''}
    </p>
    {#if hasFilters}<button onclick={clearFilters}>Clear filters</button>{/if}
  </div>
  <div class="member-table-wrap">
    <table class="member-table">
      <caption class="visually-hidden">Guild members and check-ins for the week beginning {weekIso}</caption>
      <thead>
        <tr>
          <th scope="col">Player</th>
          <th scope="col">Main character</th>
          <th scope="col">Check-in</th>
          {#if showAttendance}<th scope="col">Attendance (last {RECORD_LOOKBACK_WEEKS} weeks)</th>{/if}
          {#if canManage()}<th scope="col"><span class="visually-hidden">Actions</span></th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each filteredRows as { member, main, alts, status, source, record } (member.id)}
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
              {:else}
                <span class="muted">No active character</span>
              {/if}
            </td>
            <td data-label="Check-in"
              ><span class={status.tone}>{status.label}</span><small>{source}</small></td
            >
            {#if showAttendance}<td data-label="Attendance">{record ?? '—'}</td>{/if}
            {#if canManage()}
              <td class="row-actions">
                <button disabled={isMe} onclick={() => actAs(member)}>{isMe ? 'Acting as' : 'Act as'}</button>
                <button onclick={() => (editing = { memberId: member.id })} aria-label="Edit {member.name}"
                  >Edit</button
                >
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if !filteredRows.length}
    <div class="member-empty">
      <Icon name="search" size={28} />
      <h3>No players match these filters.</h3>
      <p>Try another name, role, or check-in status, or clear the filters to see everyone.</p>
    </div>
  {/if}
</section>

<p class="note">
  {#if !remote.guildId}
    Everything is saved in this browser. “Act as” stands in for sign-in until your guild is online.
  {:else if canManage()}
    Players join with the invite link above, or you can add a player’s Discord ID yourself. As an officer you
    can act as anyone to fill in their availability.
  {:else}
    Officers manage the player list. You can edit your own availability and characters.
  {/if}
</p>

<MemberDialog open={editing !== null} member={editingMember} onclose={() => (editing = null)} />
