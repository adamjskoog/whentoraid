<script>
  import { displayZone } from '../lib/display.svelte.js'
  import { dayBoundaries, rangeFromSelection, rangesForDay } from '../lib/availability-ranges.js'
  import { exactSessionLabel } from '../lib/personal-raids.js'
  import { addDays, formatMonthDay } from '../lib/time.js'
  import { DAYS } from '../lib/constants.js'

  let { weekIso, grid, ranges, onpaint, oneditstart = () => {}, oneditend = () => {} } = $props()
  const zone = $derived(displayZone(grid))
  const days = $derived(
    DAYS.map((name, day) => ({ name, day, boundaries: dayBoundaries(weekIso, day, grid) })),
  )
  let error = $state('')

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

<p class="note">
  Choose the times you can play in {zone}. Days below follow {grid.timezone}; each time includes its actual
  local date.
</p>
{#if error}<p role="alert" class="warning">{error}</p>{/if}
<div class="day-ranges">
  {#each days as { name, day, boundaries } (day)}
    {@const saved = rangesForDay(ranges, boundaries)}
    <section aria-label={`${name} availability`}>
      <h3>{name} {formatMonthDay(addDays(weekIso, day))}</h3>
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
            onclick={() => edit({ start: boundaries[0], end: boundaries.at(-1) }, false)}>Clear {name}</button
          >{/if}
      </form>
    </section>
  {/each}
</div>

<style>
  section {
    padding: 1rem 0;
    border-top: 1px solid var(--border, #3c3a3a);
  }
  h3 {
    margin: 0 0 0.5rem;
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
      flex-basis: 100%;
    }
  }
</style>
