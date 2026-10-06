<script>
  import { app } from '../lib/app.svelte.js'
  import { attendanceRecord, formatRecord, RECORD_LOOKBACK_WEEKS } from '../lib/attendance.js'
  import { charactersOf, getCheckin, isOffered, memberById } from '../lib/model.js'
  import Modal from './Modal.svelte'
  import { rosterExplanation } from '../lib/raid-workflow.js'

  /** Pick which of a member's characters to bring, or move them to the bench. */
  let { open, memberId, inTeam, onpick, onbench, onclose, plan, players = [] } = $props()

  const member = $derived(memberId ? memberById(app.data, memberId) : null)
  const characters = $derived(memberId ? charactersOf(app.data, memberId) : [])
  const checkin = $derived(memberId ? getCheckin(app.data, app.data.currentWeek, memberId) : null)
  const record = $derived(
    memberId ? formatRecord(attendanceRecord(app.data, app.data.currentWeek, memberId)) : null,
  )
</script>

<Modal {open} {onclose}>
  {#if member}
    <h2>{member.name}’s characters</h2>
    <p>Switch characters or adjust this player’s role.</p>
    <small>Attendance, last {RECORD_LOOKBACK_WEEKS} weeks: {record ?? 'nothing recorded yet'}</small>
    {#if plan}
      <h3>Why this roster?</h3>
      <ul>
        {#each rosterExplanation(app.data, plan, players, memberId) as reason (reason)}<li>
            {reason}
          </li>{/each}
      </ul>
      <p class="note">
        Rebuilds fill role slots first, then favor recent sit-outs, then mains. Equal scores use guild member
        order. Officer choices can override that order.
      </p>
    {/if}
    <div class="modal-list">
      {#each characters as character (character.id)}
        <button onclick={() => onpick(character)}>
          <strong>{character.name}</strong>
          <small>
            {character.spec}
            {character.class} · {character.role}{isOffered(checkin, character.id, app.data.currentRaidId)
              ? ''
              : ' · Not offered this week'}
          </small>
        </button>
      {/each}
    </div>
    {#if inTeam}
      <button class="spaced-top" onclick={onbench}>Move to bench</button>
    {/if}
  {/if}
</Modal>
