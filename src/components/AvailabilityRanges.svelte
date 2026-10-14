<script>
  import { displayZone } from '../lib/display.svelte.js'
  import {
    copyRangesToDay,
    dayBoundaries,
    rangeFromSelection,
    rangesForDay,
  } from '../lib/availability-ranges.js'
  import { exactSessionLabel } from '../lib/personal-raids.js'
  import { addDays, formatMonthDay } from '../lib/time.js'
  import { DAYS } from '../lib/constants.js'

  let { weekIso, grid, ranges, onpaint, oneditstart = () => {}, oneditend = () => {} } = $props()
  const zone = $derived(displayZone(grid))
  const days = $derived(
    DAYS.map((name, day) => ({ name, day, boundaries: dayBoundaries(weekIso, day, grid) })),
  )
  let error = $state('')
  let copyTargets = $state({})
  let copied = $state('')

  function copyDay(day) {
    const target = copyTargets[day] ?? (day === 0 ? 1 : 0)
    const intervals = copyRangesToDay(ranges, weekIso, day, target, grid)
    if (!intervals.length) {
      error = 'These times do not fit the selected day. Add times for that day instead.'
      return
    }
    error = ''
    oneditstart()
    for (const interval of intervals) onpaint(interval, true)
    oneditend()
    copied = `${DAYS[day]} times added to ${DAYS[target]}. Existing times were kept.`
  }

  function summaryLabel(interval) {
    const sameZone = zone === grid.timezone
    if (!sameZone) return exactSessionLabel(interval, zone)
    const format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' })
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return `${format.format(interval.start)}–${format.format(interval.end)}${date.format(interval.start) !== date.format(interval.end) ? ' (+1 day)' : ''}`
  }

  function label(instant) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(instant)
  }

  function add(event, boundaries) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const interval = rangeFromSelection(boundaries, form.get('start'), form.get('end'))
    if (!interval) {
      error = 'Choose an end time after the start time.'
      return
    }
    edit(interval, true)
  }

  function edit(interval, available) {
    error = ''
    oneditstart()
    onpaint(interval, available)
    oneditend()
  }
</script>

{#if zone !== grid.timezone}<p class="note">
    Days follow {grid.timezone}. Times show your local date in {zone}.
  </p>{/if}
{#if error}<p role="alert" class="warning">{error}</p>{/if}
{#if copied}<p role="status" class="copy-status">{copied}</p>{/if}
<div class="day-ranges">
  {#each days as { name, day, boundaries } (day)}
    {@const saved = rangesForDay(ranges, boundaries)}
    <details class="day-editor">
      <summary aria-label={`Edit ${name} availability`} aria-describedby={`day-summary-${day}`}
        ><span class="day-heading"
          ><strong>{name}</strong><small>{formatMonthDay(addDays(weekIso, day))}</small></span
        ><span id={`day-summary-${day}`} class="day-summary" class:has-times={saved.length > 0}
          >{saved.length ? saved.map(summaryLabel).join(' · ') : 'No times added'}</span
        ><span class="day-edit-label" aria-hidden="true">Edit</span></summary
      >
      <section aria-label={`${name} availability`} class="day-editor-content">
        {#if saved.length}
          <ul>
            {#each saved as interval (`${interval.start}:${interval.end}`)}
              <li>
                <span>{exactSessionLabel(interval, zone)}</span><button
                  aria-label={`Remove ${name} availability ${label(interval.start)}`}
                  onclick={() => edit(interval, false)}>Remove</button
                >
              </li>
            {/each}
          </ul>
        {:else}<p class="note">No times added</p>{/if}
        <form onsubmit={(event) => add(event, boundaries)}>
          <label class="field"
            >{name} from<select name="start"
              >{#each boundaries.slice(0, -1) as instant (instant)}<option value={instant}
                  >{label(instant)}</option
                >{/each}</select
            ></label
          >
          <label class="field"
            >{name} until<select name="end"
              >{#each boundaries.slice(1) as instant (instant)}<option
                  value={instant}
                  selected={instant === boundaries.at(-1)}>{label(instant)}</option
                >{/each}</select
            ></label
          >
          <button aria-label={`Add times for ${name}`}>Add times</button>
          {#if saved.length}<button
              type="button"
              onclick={() => edit({ start: boundaries[0], end: boundaries.at(-1) }, false)}
              >Clear {name}</button
            >{/if}
        </form>
        {#if saved.length}
          <div class="copy-day">
            <label class="field"
              >Copy {name} times to<select
                value={copyTargets[day] ?? (day === 0 ? 1 : 0)}
                onchange={(event) => (copyTargets[day] = Number(event.currentTarget.value))}
                >{#each DAYS as targetName, target (targetName)}{#if target !== day}<option value={target}
                      >{targetName}</option
                    >{/if}{/each}</select
              ></label
            ><button type="button" onclick={() => copyDay(day)}>Copy {name} times</button>
          </div>
        {/if}
      </section>
    </details>
  {/each}
</div>

<style>
  .day-editor {
    border-bottom: 1px solid var(--line);
  }
  summary {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 0;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .day-heading {
    flex: 0 0 66px;
  }
  .day-heading strong {
    font-size: 14px;
  }
  .day-summary {
    flex: 1;
    color: var(--muted);
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .day-summary.has-times {
    color: var(--text);
  }
  .day-edit-label {
    color: var(--gold);
    font-size: 12px;
  }
  .day-editor-content {
    padding: 0 0 20px;
  }
  .copy-day {
    display: flex;
    gap: 10px;
    align-items: end;
    margin-top: 16px;
  }
  .copy-status {
    font-size: 13px;
    color: var(--green);
  }
  form {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    align-items: end;
  }
  label {
    flex: 1 1 13rem;
    min-width: 0;
  }
  select {
    max-width: 100%;
    width: 100%;
  }
  ul {
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  li > span {
    flex: 1 1 16rem;
  }
  @media (max-width: 600px) {
    form label {
      flex-basis: 40%;
    }
  }
</style>
