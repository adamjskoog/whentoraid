<script>
  import { app } from '../lib/app.svelte.js'
  import { ATTENDANCE_OPTIONS } from '../lib/attendance.js'
  import { characterById, memberById } from '../lib/model.js'
  import CollapsibleSection from './CollapsibleSection.svelte'

  /**
   * After the raid: record who attended, was late, or did not show, or mark the raid cancelled.
   * `onmark(memberId, status | null)` clicking the pressed status again clears it.
   */
  let { team, attendance = {}, cancelled = false, onmark, oncancelled } = $props()

  const recorded = $derived(team.filter((e) => attendance[e.memberId]).length)
</script>

<section class="panel attendance" aria-labelledby="attendance-heading">
  <CollapsibleSection title={`After the raid · ${recorded}/${team.length} recorded`}>
    <div class="section-head">
      <div>
        <h2 id="attendance-heading">After the raid</h2>
        <small>
          {cancelled
            ? 'Marked as cancelled: it will not count toward attendance or bench fairness.'
            : `${recorded} of ${team.length} recorded. Attendance feeds each player’s record on Guild members.`}
        </small>
      </div>
      <label class="checkbox-row">
        <input type="checkbox" checked={cancelled} onchange={(e) => oncancelled(e.currentTarget.checked)} />
        Raid was cancelled
      </label>
    </div>
    {#if !cancelled}
      <ul class="attendance-list">
        {#each team as entry (entry.memberId)}
          {@const member = memberById(app.data, entry.memberId)}
          {@const character = characterById(app.data, entry.characterId)}
          {@const status = attendance[entry.memberId]}
          <li>
            <span>
              <strong>{character?.name ?? '?'}</strong>
              <small>{member?.name ?? '?'} · {entry.role}</small>
            </span>
            <span class="buttons" role="group" aria-label="Attendance for {character?.name ?? 'player'}">
              {#each ATTENDANCE_OPTIONS as option (option.value)}
                <button
                  class="chip"
                  aria-pressed={status === option.value}
                  onclick={() => onmark(entry.memberId, status === option.value ? null : option.value)}
                  >{option.label}</button
                >
              {/each}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </CollapsibleSection>
</section>
