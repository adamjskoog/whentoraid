<script>
  import { CLASS_NAMES, CLASS_SPECS, ROLES } from '../lib/constants.js'

  /**
   * Inputs for one character. `prefix` namespaces the field names when the form also has other
   * fields called "name"; read them back with `readCharacterFields` from lib/forms.js.
   */
  let { draft = { name: '', realm: '', class: 'Warrior', spec: '', role: 'DPS' }, prefix = '' } = $props()

  // Form defaults: the selects own their values after the first render.
  // svelte-ignore state_referenced_locally
  let characterClass = $state(draft.class)
  // svelte-ignore state_referenced_locally
  let spec = $state(draft.spec)

  /** A spec saved before the dropdown existed stays selectable until the class changes. */
  const specs = $derived.by(() => {
    const known = CLASS_SPECS[characterClass] ?? []
    return spec && characterClass === draft.class && !known.includes(spec) ? [spec, ...known] : known
  })

  function chooseClass(event) {
    characterClass = event.currentTarget.value
    if (!(CLASS_SPECS[characterClass] ?? []).includes(spec)) spec = ''
  }
</script>

<label class="field"
  >Character name<input name="{prefix}name" required maxlength="30" value={draft.name} /></label
>
<label class="field">Realm<input name="{prefix}realm" required maxlength="60" value={draft.realm} /></label>
<label class="field">
  Class
  <select name="{prefix}class" value={characterClass} onchange={chooseClass}>
    {#each CLASS_NAMES as name (name)}
      <option>{name}</option>
    {/each}
  </select>
</label>
<label class="field">
  Specialization
  <select name="{prefix}spec" required bind:value={spec}>
    <option value="" disabled>Choose a specialization</option>
    {#each specs as name (name)}
      <option>{name}</option>
    {/each}
  </select>
</label>
<label class="field">
  Raid role
  <select name="{prefix}role">
    {#each ROLES as role (role)}
      <option selected={role === draft.role}>{role}</option>
    {/each}
  </select>
</label>
