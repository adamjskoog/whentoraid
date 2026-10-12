<script>
  import { app } from '../lib/app.svelte.js'
  import { onboardingSteps } from '../lib/personal-raids.js'
  let { memberId = app.data.currentMemberId, weekIso = app.data.currentWeek } = $props()
  const steps = $derived(onboardingSteps(app.data, memberId, weekIso))
  const complete = $derived(steps.every((step) => step.complete))
</script>

<section class="panel onboarding" aria-label="Getting ready to raid">
  <h2>{complete ? 'You’re ready for planning' : 'Get ready for your first raid'}</h2>
  <p>
    {complete
      ? 'Your character and availability are ready for the officers.'
      : 'Complete these steps so officers can include you in a roster.'}
  </p>
  <ol>
    {#each steps as step (step.id)}
      <li class:done={step.complete}>
        <span aria-hidden="true">{step.complete ? '✓' : '○'}</span>
        <span>{step.label}<small>{step.complete ? 'Complete' : 'To do'}</small></span>
        {#if !step.complete && step.view}
          <button
            onclick={() => {
              app.data = { ...app.data, currentWeek: weekIso }
              app.view = step.view
            }}>{step.id === 'character' ? 'Add character' : 'Set availability'}</button
          >
        {/if}
      </li>
    {/each}
  </ol>
</section>

<style>
  .onboarding {
    margin: 1.5rem 0;
  }
  ol {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.75rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  li > span:nth-child(2) {
    flex: 1;
  }
  small {
    display: block;
    opacity: 0.7;
  }
  .done > span:first-child {
    color: var(--green, #92c892);
  }
</style>
