<script>
  import { app } from '../lib/app.svelte.js'
  import { requestLeave } from '../lib/leave-guard.js'
  import { getRaid, setCurrentRaid } from '../lib/raids.js'
  const raid = $derived(getRaid(app.data))
</script>

<section class="raid-selector" aria-label="Choose a raid">
  <div class="buttons">
    {#each app.data.settings.raids as option (option.id)}
      <button
        type="button"
        aria-label={`${option.name} · ${option.size} players`}
        class:primary={raid.id === option.id}
        aria-pressed={raid.id === option.id}
        onclick={() => requestLeave(() => (app.data = setCurrentRaid(app.data, option.id)))}
        >{option.name}<span class="raid-size">{option.size}</span></button
      >
    {/each}
  </div>
  <p class="raid-composition">
    {raid.targets[0]} tanks · {raid.targets[1]} healers · {raid.targets[2]} damage · {raid.durationSlots / 2} hours.
  </p>
</section>

<style>
  .raid-selector {
    margin: 0 0 1rem;
    min-width: 0;
  }
  .raid-size {
    margin-left: 0.6rem;
    opacity: 0.7;
    font-size: 12px;
  }
  .raid-composition {
    margin: 0.6rem 0 0;
    font-size: 12px;
  }
</style>
