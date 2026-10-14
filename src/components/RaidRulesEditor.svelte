<script>
  import { app } from '../lib/app.svelte.js'
  import { CLASS_NAMES, CLASS_SPECS } from '../lib/constants.js'
  import { MAX_UTILITIES, raidRules, saveRaidRules } from '../lib/composition-rules.js'
  import { getRaid } from '../lib/raids.js'
  import { canManage } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /**
   * Optional rules for the selected raid profile: class limits, required utilities, and what breaks
   * ties between equally complete rosters. Saved separately from the main settings form.
   */
  const raid = $derived(getRaid(app.data))

  /** "Mage" for any spec of a class, "Mage/Frost" for one specialization. */
  const optionKey = ({ class: className, spec }) => (spec ? `${className}/${spec}` : className)
  const fromKey = (key) => {
    const [className, spec] = key.split('/')
    return spec ? { class: className, spec } : { class: className }
  }

  let limits = $state({})
  let utilities = $state([])
  let priority = $state('fairness')

  // Reload the editor from the saved rules whenever the selected raid or its saved rules change.
  $effect(() => {
    const saved = raidRules(raid)
    limits = Object.fromEntries(CLASS_NAMES.map((name) => [name, saved.classLimits[name] ?? '']))
    utilities = saved.requiredUtilities.map((utility) => ({
      id: utility.id,
      name: utility.name,
      eligible: utility.eligible.map(optionKey),
    }))
    priority = saved.priority
  })

  function newId(name) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
    return `${slug || 'utility'}-${Math.random().toString(36).slice(2, 8)}`
  }

  function addUtility() {
    utilities = [...utilities, { id: '', name: '', eligible: [] }]
  }

  function removeUtility(index) {
    utilities = utilities.filter((_, i) => i !== index)
  }

  function toggle(index, key, checked) {
    utilities = utilities.map((utility, i) =>
      i !== index
        ? utility
        : {
            ...utility,
            eligible: checked ? [...utility.eligible, key] : utility.eligible.filter((k) => k !== key),
          },
    )
  }

  function save(event) {
    event.preventDefault()
    if (!canManage()) return showToast('Only officers can change raid rules.')
    const classLimits = Object.fromEntries(
      Object.entries(limits)
        .filter(([, value]) => value !== '' && value !== null && value !== undefined)
        .map(([name, value]) => [name, Number(value)]),
    )
    const rules = {
      classLimits,
      priority,
      requiredUtilities: utilities.map((utility) => ({
        id: utility.id || newId(utility.name),
        name: utility.name,
        eligible: utility.eligible.map(fromKey),
      })),
    }
    const result = saveRaidRules(app.data, raid.id, rules)
    if (result.error) return showToast(result.error)
    app.data = result.state
    showToast(`Roster rules saved for ${raid.name}.`)
  }
</script>

<form class="panel settings-panel" onsubmit={save} aria-label="Roster rules">
  <fieldset class="plain" disabled={!canManage()}>
    <details class="settings-section">
      <summary><h2>Roster rules</h2></summary>
      <p>
        Optional rules for {raid.name}. Suggestions never exceed a class limit and prefer rosters that cover
        every required utility. You can still place anyone by hand; the planner shows a warning instead.
      </p>

      <label class="field">
        When rosters are otherwise equal, prefer
        <select bind:value={priority}>
          <option value="fairness">Players who sat out recently</option>
          <option value="mains">Main characters</option>
          <option value="preferred">Players who marked the time as preferred</option>
        </select>
      </label>

      <h3>Class limits</h3>
      <p class="note">Leave blank for no limit.</p>
      <div class="class-limits">
        {#each CLASS_NAMES as className (className)}
          <label class="field">
            {className}
            <input type="number" min="0" max="40" inputmode="numeric" bind:value={limits[className]} />
          </label>
        {/each}
      </div>

      <h3>Required utilities</h3>
      <p class="note">
        For example “Decurse”, met by any Mage or Druid. Each needs at least one qualifying class or
        specialization.
      </p>
      {#each utilities as utility, index (index)}
        <fieldset class="utility">
          <legend>Requirement {index + 1}</legend>
          <label class="field">
            Name
            <input required maxlength="40" bind:value={utility.name} placeholder="e.g. Decurse" />
          </label>
          <details>
            <summary>Who qualifies ({utility.eligible.length} selected)</summary>
            <div class="eligible">
              {#each CLASS_NAMES as className (className)}
                <div class="eligible-class">
                  <label class="checkbox-row">
                    <input
                      type="checkbox"
                      checked={utility.eligible.includes(className)}
                      onchange={(e) => toggle(index, className, e.currentTarget.checked)}
                    />
                    <strong>Any {className}</strong>
                  </label>
                  {#each CLASS_SPECS[className] as spec (spec)}
                    <label class="checkbox-row">
                      <input
                        type="checkbox"
                        checked={utility.eligible.includes(`${className}/${spec}`)}
                        onchange={(e) => toggle(index, `${className}/${spec}`, e.currentTarget.checked)}
                      />
                      {spec}
                    </label>
                  {/each}
                </div>
              {/each}
            </div>
          </details>
          <button type="button" onclick={() => removeUtility(index)}>Remove requirement</button>
        </fieldset>
      {/each}
      {#if utilities.length < MAX_UTILITIES}
        <button type="button" onclick={addUtility}>Add a required utility</button>
      {/if}
      <div class="settings-save">
        <button class="primary">Save roster rules</button>
      </div>
    </details>
  </fieldset>
</form>

<style>
  .class-limits {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
    gap: 0.5rem 1rem;
  }
  .utility {
    margin: 0.75rem 0;
    padding: 0.75rem;
    border: 1px solid var(--line, #ffffff22);
    border-radius: 6px;
  }
  .eligible {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.75rem;
    margin: 0.5rem 0;
  }
  .eligible-class {
    display: grid;
    gap: 0.15rem;
  }
</style>
