<script>
  import { app } from '../lib/app.svelte.js'
  import { ROLES } from '../lib/constants.js'

  /**
   * Sidebar checklist for the chosen session, plus composition notes. Role slots count `readyCounts`,
   * the rostered players who can play this session; `roleCounts` is everyone rostered.
   */
  let {
    sessionLabel,
    roleCounts,
    readyCounts,
    targets,
    availableCount,
    backupsLabel,
    backupsOk,
    lockedCount,
    problemCount,
    classCount,
  } = $props()
</script>

<section class="panel side-section">
  <span class="eyebrow gold">RAID READINESS</span>
  <h2 class="readiness-heading">A party with a plan.</h2>
  <p>{sessionLabel}</p>
  {#each ROLES as role, i (role)}
    {@const full = readyCounts[i] >= targets[i]}
    {@const cannotCome = roleCounts[i] - readyCounts[i]}
    <div class="check">
      <span>
        {role} slots
        {#if cannotCome > 0}<small class="warning">{cannotCome} rostered can’t play</small>{/if}
      </span>
      <span class={full ? 'ok' : 'gold'}>{readyCounts[i]} / {targets[i]} {full ? '✓' : ''}</span>
    </div>
  {/each}
  <div class="check"><span>Available players</span><span>{availableCount}</span></div>
  <div class="check">
    <span>Backups (tank · healer · damage)</span>
    <span class={backupsOk ? 'ok' : 'gold'}>{backupsLabel}</span>
  </div>
  <div class="check"><span>Locked players</span><span>{lockedCount}</span></div>
  <div class="check">
    <span>Availability conflicts</span>
    <span class={problemCount ? 'warning' : 'ok'}>{problemCount ? 'Review required' : 'All clear ✓'}</span>
  </div>
  <p class="note">
    {problemCount
      ? 'Your roster is kept when you change times. Highlighted players cannot attend the full session.'
      : 'Move a player between roles or bring an alt. The planner checks every change.'}
  </p>
</section>

<section class="panel side-section">
  <span class="eyebrow">COMPOSITION NOTES</span>
  <p class="small-text">
    This first pass balances roles and attendance. Encounter-specific buffs, resistances, and player
    experience still need officer judgment.
  </p>
  <div class="check"><span>Classes represented</span><span>{classCount}</span></div>
  <button class="full-width" onclick={() => (app.view = 'settings')}>Adjust raid requirements</button>
</section>
