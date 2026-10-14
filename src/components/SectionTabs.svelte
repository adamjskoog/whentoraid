<script>
  let { id, label, tabs, value, onselect } = $props()

  function navigate(event, index) {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null
    if (next === null) return
    event.preventDefault()
    onselect(tabs[next].id)
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus()
  }
</script>

<div class="section-tabs" role="tablist" aria-label={label}>
  {#each tabs as tab, index (tab.id)}
    <button
      type="button"
      role="tab"
      id={`${id}-tab-${tab.id}`}
      aria-controls={`${id}-panel-${tab.id}`}
      aria-selected={value === tab.id}
      tabindex={value === tab.id ? 0 : -1}
      onclick={() => onselect(tab.id)}
      onkeydown={(event) => navigate(event, index)}
    >
      {tab.label}{#if tab.count !== undefined}<span class="tab-count">{tab.count}</span>{/if}
    </button>
  {/each}
</div>
