<script>
  import { formatDateIn, formatTimesIn } from '../lib/grid.js'
  import { formatBackups, formatMissing, missingRoles } from '../lib/planning.js'

  /** The top raid windows as cards; choosing one calls `onchoose(suggestion)`. */
  let { suggestions, checkedInCount, totalSlots, targets, selectedStart, zone, onchoose } = $props()
</script>

{#if checkedInCount === 0}
  <p class="note empty-week">
    Nobody has checked in for this week yet, so there is nothing to rank. Copy the reminder from the Check-ins
    panel and post it in Discord.
  </p>
{:else}
  <div class="candidates">
    {#each suggestions as suggestion, i (suggestion.day)}
      {@const missing = formatMissing(missingRoles(suggestion.team, targets))}
      <button
        class="candidate"
        class:selected={suggestion.start === selectedStart}
        onclick={() => onchoose(suggestion)}
      >
        <span class="rank">{i === 0 ? '✦ TOP SUGGESTION' : `ALTERNATIVE 0${i}`}</span>
        <b>{formatDateIn(suggestion, zone)}</b>
        <small>{formatTimesIn(suggestion, zone)}</small>
        <span class="count">{suggestion.team.length} / {totalSlots} roles filled</span>
        {#if missing}<small class="short">{missing}</small>{/if}
        <small class="backups">Backups: {formatBackups(suggestion.backups)}</small>
      </button>
    {/each}
  </div>
{/if}
