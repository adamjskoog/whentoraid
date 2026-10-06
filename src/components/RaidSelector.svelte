<script>
  import { app } from '../lib/app.svelte.js'
  import { getRaid, setCurrentRaid } from '../lib/raids.js'
  const raid = $derived(getRaid(app.data))
</script>

<section class="panel raid-selector" aria-label="Choose a raid">
  <div class="buttons">
    {#each app.data.settings.raids as option (option.id)}
      <button
        type="button"
        class:primary={raid.id === option.id}
        aria-pressed={raid.id === option.id}
        onclick={() => (app.data = setCurrentRaid(app.data, option.id))}
        >{option.name} · {option.size} players</button
      >
    {/each}
  </div>
  <p class="note">
    {raid.targets[0]} tanks · {raid.targets[1]} healers · {raid.targets[2]} damage · {raid.durationSlots / 2} hours.
    Each raid keeps its own composition and roster.
  </p>
</section>

<style>
  .raid-selector {
    margin: 1rem 0;
  }
  .note {
    margin-bottom: 0;
  }
</style>
