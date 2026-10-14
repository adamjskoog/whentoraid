<script>
  import { app } from '../lib/app.svelte.js'
  import { displayZone } from '../lib/display.svelte.js'
  import { formatDateIn } from '../lib/grid.js'
  import { attentionCount, officerDashboard } from '../lib/officer-dashboard.js'
  import { formatClock, formatMonthDay, wallTime } from '../lib/time.js'

  /** Officers: upcoming raids across the next few weeks and what each still needs. */
  let { now } = $props()

  const weeks = $derived(officerDashboard(app.data, now))
  const needing = $derived(attentionCount(weeks))
  const zone = $derived(displayZone(app.data.guild))
  const STATUS_LABELS = {
    unplanned: 'Not planned',
    draft: 'Draft',
    published: 'Published',
    cancelled: 'Cancelled',
  }

  const when = (start) =>
    start === null
      ? 'No time chosen'
      : `${formatDateIn({ start }, zone)} · ${formatClock(wallTime(start, zone).minutes)}`

  function open(raid) {
    app.data = { ...app.data, currentWeek: raid.weekIso, currentRaidId: raid.raidId }
    app.view = 'planner'
  }
</script>

<section class="panel officer-dashboard" aria-label="Officer dashboard">
  <div class="heading">
    <div>
      <span class="eyebrow gold">OFFICER DASHBOARD</span>
      <h2>Upcoming raids</h2>
    </div>
    <span class="badge" class:success={needing === 0} role="status"
      >{needing === 0 ? 'Nothing needs attention' : `${needing} need attention`}</span
    >
  </div>
  {#each weeks.filter((week) => week.raids.length) as week (week.weekIso)}
    <h3>
      Week of {formatMonthDay(week.weekIso)}
      {#if week.waiting}<small>· {week.waiting} not checked in</small>{/if}
    </h3>
    <ul>
      {#each week.raids as raid (raid.raidId)}
        <li>
          <div class="what">
            <strong>{raid.raidName}</strong>
            <small>{when(raid.start)} · {STATUS_LABELS[raid.status]}</small>
          </div>
          <div class="issues">
            {#if raid.issues.length}
              <ul class="issue-list">
                {#each raid.issues as issue, i (i)}<li>{issue.message}</li>{/each}
              </ul>
            {:else if raid.status !== 'cancelled'}
              <span class="ok">Ready</span>
            {/if}
          </div>
          <button
            onclick={() => open(raid)}
            aria-label={`Open ${raid.raidName}, week of ${formatMonthDay(raid.weekIso)}`}>Open</button
          >
        </li>
      {/each}
    </ul>
  {/each}
</section>

<style>
  .officer-dashboard {
    margin-bottom: 24px;
    border-top: 2px solid var(--gold);
  }
  .heading {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem 1rem;
  }
  h3 {
    margin: 1.25rem 0 0.25rem;
    font-size: 14px;
  }
  h3 small {
    font-weight: normal;
    color: var(--muted);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--line);
  }
  .what {
    flex: 1 1 12rem;
    display: grid;
  }
  .what small {
    color: var(--muted);
  }
  .issues {
    flex: 2 1 16rem;
  }
  .issue-list li {
    padding: 0;
    border: 0;
    color: var(--red);
    font-size: 13px;
  }
  .issue-list li::before {
    content: '• ';
  }
  .ok {
    color: var(--green);
    font-size: 13px;
  }
</style>
