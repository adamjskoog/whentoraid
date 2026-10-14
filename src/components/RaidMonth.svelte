<script>
  import { app } from '../lib/app.svelte.js'
  import { DAYS } from '../lib/constants.js'
  import { raidMonthEntries } from '../lib/raid-series.js'
  import { canManage } from '../lib/remote/sync.svelte.js'
  import { addDays, dayOfMonth, formatClock, todayIso, wallTime, weekdayIndex } from '../lib/time.js'

  /**
   * A month of raids in the guild timezone. Officers see drafts and scheduled dates too; players see
   * only published rosters, at their published times.
   */
  const zone = $derived(app.data.guild.timezone)
  const today = $derived(todayIso(zone))
  let month = $state(todayIso(app.data.guild.timezone).slice(0, 7))

  const STATUS_LABELS = {
    published: 'Published',
    draft: 'Draft',
    scheduled: 'Scheduled',
    cancelled: 'Cancelled',
  }

  const entries = $derived(raidMonthEntries(app.data, month, { publishedOnly: !canManage() }))
  const firstDay = $derived(`${month}-01`)
  const days = $derived.by(() => {
    const list = []
    for (let date = firstDay; date.startsWith(month); date = addDays(date, 1)) list.push(date)
    return list
  })
  const padding = $derived(Array.from({ length: weekdayIndex(firstDay) }, (_, i) => i))
  const title = $derived(
    new Date(`${firstDay}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  )

  function shift(months) {
    const [year, m] = month.split('-').map(Number)
    month = new Date(Date.UTC(year, m - 1 + months, 1)).toISOString().slice(0, 7)
  }

  function open(entry) {
    app.data = { ...app.data, currentWeek: entry.weekIso, currentRaidId: entry.raidId }
    if (!canManage() || entry.status === 'published') app.plannerIntent = 'published'
    app.view = 'planner'
  }
</script>

<section class="panel raid-month" aria-label="Raid calendar">
  <div class="heading">
    <h2>{title}</h2>
    <div class="buttons">
      <button onclick={() => shift(-1)} aria-label="Previous month">←</button>
      <button onclick={() => (month = today.slice(0, 7))}>This month</button>
      <button onclick={() => shift(1)} aria-label="Next month">→</button>
    </div>
  </div>
  <p class="note">
    Times in {zone.replaceAll('_', ' ')}.{canManage() ? ' Scheduled dates have no draft yet.' : ''}
  </p>
  <div class="month-grid">
    {#each DAYS as name (name)}<div class="weekday" aria-hidden="true">{name}</div>{/each}
    {#each padding as i (i)}<div class="pad" aria-hidden="true"></div>{/each}
    {#each days as date (date)}
      {@const items = entries.filter((entry) => entry.dateIso === date)}
      <div class="day" class:today={date === today} class:empty={!items.length}>
        <span class="date"
          ><span class="weekday-inline">{DAYS[weekdayIndex(date)]} </span>{dayOfMonth(date)}</span
        >
        {#each items as entry (`${entry.raidId}:${entry.weekIso}`)}
          <button class="entry {entry.status}" onclick={() => open(entry)}>
            <strong>{entry.raidName}</strong>
            <small>{formatClock(wallTime(entry.start, zone).minutes)} · {STATUS_LABELS[entry.status]}</small>
          </button>
        {/each}
      </div>
    {/each}
  </div>
  {#if !entries.length}<p class="note">No raids this month.</p>{/if}
</section>

<style>
  .raid-month {
    margin-top: 1.5rem;
  }
  .heading {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem 1rem;
  }
  .month-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
  }
  .weekday {
    font-size: 12px;
    color: var(--muted);
    text-align: center;
  }
  .day {
    min-height: 5.5rem;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 6px;
    display: grid;
    align-content: start;
    gap: 4px;
  }
  .day.today {
    border-color: var(--gold);
  }
  .date {
    font-size: 12px;
    color: var(--muted);
  }
  .weekday-inline {
    display: none;
  }
  .entry {
    display: grid;
    text-align: left;
    padding: 4px 6px;
    font-size: 12px;
    border-left: 3px solid var(--muted);
    min-width: 0;
  }
  .entry strong,
  .entry small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entry.published {
    border-left-color: var(--blue);
  }
  .entry.draft {
    border-left-color: var(--gold);
  }
  .entry.cancelled {
    border-left-color: var(--red);
    text-decoration: line-through;
  }
  @media (max-width: 700px) {
    .month-grid {
      grid-template-columns: 1fr;
    }
    .weekday,
    .pad,
    .day.empty {
      display: none;
    }
    .day {
      min-height: 0;
    }
    .weekday-inline {
      display: inline;
    }
  }
</style>
