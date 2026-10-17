<script>
  import { app } from '../lib/app.svelte.js'
  import { characterById, memberById } from '../lib/model.js'
  import { responseSummary } from '../lib/raid-services.js'
  import { viewerZone } from '../lib/display.svelte.js'
  import { formatClock, wallTime } from '../lib/time.js'

  /**
   * Officers: who has confirmed the published roster, who reported a problem, and who has not
   * answered. `canReplace(memberId)` says whether the player is still in the draft to swap out.
   */
  let {
    team,
    byMember,
    error = '',
    checkedAt = null,
    checking = false,
    zone,
    canReplace,
    onreplace,
    onrefresh,
  } = $props()

  const summary = $derived(responseSummary(team, byMember))
  const checkedLabel = $derived(
    checkedAt === null ? '' : `Last checked ${formatClock(wallTime(checkedAt, zone ?? viewerZone).minutes)}`,
  )
  const name = (memberId) => memberById(app.data, memberId)?.name ?? 'Removed player'
</script>

<section class="panel spaced-top" aria-label="Player responses">
  <div class="heading">
    <h2>Player responses</h2>
    <button onclick={onrefresh} disabled={checking}>{checking ? 'Checking…' : 'Refresh'}</button>
  </div>
  {#if checkedLabel}<p class="note" role="status">{checkedLabel} · updates every minute while open</p>{/if}
  {#if error}
    <p class="warning">Responses could not be loaded: {error}</p>
  {:else}
    <p>
      {summary.confirmed.length} confirmed · {summary.tentative.length} tentative · {summary.unavailable
        .length} can’t make it · {summary.waiting.length} not answered
    </p>
    {#if summary.tentative.length}
      <p class="warning">Tentative: {summary.tentative.map((entry) => name(entry.memberId)).join(', ')}</p>
    {/if}
    {#if summary.unavailable.length}
      <ul>
        {#each summary.unavailable as entry (entry.memberId)}
          {@const response = byMember[entry.memberId]}
          <li>
            <span>
              <strong>{name(entry.memberId)}</strong> can’t make it
              <small>{characterById(app.data, entry.characterId)?.name ?? 'Character'} · {entry.role}</small>
              {#if response.note}<q>{response.note}</q>{/if}
            </span>
            {#if canReplace(entry.memberId)}
              <button onclick={() => onreplace(entry.memberId)}
                >Find a replacement for {name(entry.memberId)}</button
              >
            {:else}
              <small>Already changed in the draft</small>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if summary.waiting.length}
      <p class="note">Not answered: {summary.waiting.map((entry) => name(entry.memberId)).join(', ')}</p>
    {/if}
  {/if}
</section>

<style>
  .heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }
  ul {
    list-style: none;
    padding: 0;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: center;
    margin: 0.5rem 0;
  }
  li > span {
    flex: 1 1 16rem;
  }
  small,
  q {
    display: block;
    opacity: 0.8;
  }
</style>
