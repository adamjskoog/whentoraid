<script>
  import { app } from '../lib/app.svelte.js'
  import { weeklyOverview } from '../lib/raid-workflow.js'
  import { setCurrentRaid } from '../lib/raids.js'
  import { formatSessionIn } from '../lib/grid.js'
  import { displayZone } from '../lib/display.svelte.js'
  import { memberById } from '../lib/model.js'
  let { publishedOnly = false } = $props()
  const raids = $derived(weeklyOverview(app.data, app.data.currentWeek, publishedOnly))
</script>

<section class="panel weekly-overview" aria-labelledby="weekly-overview-heading">
  <h2 id="weekly-overview-heading">This week’s raids</h2>
  <div class="raid-weeks">
    {#each raids as item (item.raid.id)}
      <article class:has-conflicts={item.overlaps.length > 0}>
        <button
          class="raid-link"
          aria-label="Open {item.raid.name}"
          onclick={() => (app.data = setCurrentRaid(app.data, item.raid.id))}>{item.raid.name}</button
        >
        <p>
          {item.cancelled
            ? 'Cancelled'
            : !item.plan
              ? publishedOnly
                ? 'Not published'
                : 'Not planned'
              : item.published
                ? publishedOnly
                  ? 'Published'
                  : 'Draft · published version available'
                : 'Draft'}
        </p>
        {#if item.plan}
          <small
            >{formatSessionIn(item.plan, displayZone(app.data.guild))} · {item.plan.team
              .length}/{item.plan.targets?.reduce((a, b) => a + b, 0) ?? item.raid.size} players</small
          >
        {/if}
        {#each item.overlaps as overlap (`${overlap.week}-${overlap.raidId}`)}
          <p class="warning">
            Overlaps {overlap.raidName}: {overlap.memberIds
              .map((id) => memberById(app.data, id)?.name ?? 'Unknown player')
              .join(', ')}
          </p>
        {/each}
      </article>
    {/each}
  </div>
</section>

<style>
  .weekly-overview {
    margin: 1rem 0;
  }
  .raid-weeks {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
  }
  article {
    border-left: 2px solid var(--gold, #c8a961);
    padding-left: 0.8rem;
    min-width: 0;
  }
  .has-conflicts {
    border-color: #dd8664;
  }
  .raid-link {
    text-align: left;
    width: 100%;
  }
  p {
    margin: 0.5rem 0;
  }
  @media (max-width: 700px) {
    .raid-weeks {
      grid-template-columns: 1fr;
    }
  }
</style>
