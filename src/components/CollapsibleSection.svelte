<script>
  import { onMount } from 'svelte'
  let { title, children } = $props()
  let expanded = $state(true)
  onMount(() => {
    expanded = !globalThis.matchMedia?.('(max-width: 700px)').matches
  })
</script>

<details bind:open={expanded}>
  <summary
    ><h3>{title}</h3>
    <span>{expanded ? 'Hide' : 'Show'}</span></summary
  >
  {@render children()}
</details>

<style>
  summary {
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 0;
  }
  summary h3 {
    margin: 0;
  }
  summary span {
    font-size: 0.8rem;
  }
  summary:focus-visible {
    outline: 2px solid var(--gold, #c8a961);
    outline-offset: 4px;
  }
</style>
