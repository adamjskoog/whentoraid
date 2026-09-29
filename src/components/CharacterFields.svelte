<script>
  import { CLASS_NAMES, ROLES } from '../lib/constants.js'

  /**
   * Inputs for one character. `prefix` namespaces the field names when the form also has other
   * fields called "name"; read them back with `readCharacterFields` from lib/forms.js.
   */
  let { draft = { name: '', realm: '', class: 'Warrior', spec: '', role: 'DPS' }, prefix = '' } = $props()
</script>

<label class="field"
  >Character name<input name="{prefix}name" required maxlength="30" value={draft.name} /></label
>
<label class="field">Realm<input name="{prefix}realm" required maxlength="60" value={draft.realm} /></label>
<label class="field">
  Class
  <select name="{prefix}class">
    {#each CLASS_NAMES as name (name)}
      <option selected={name === draft.class}>{name}</option>
    {/each}
  </select>
</label>
<label class="field"
  >Specialization<input name="{prefix}spec" required maxlength="40" value={draft.spec} /></label
>
<label class="field">
  Raid role
  <select name="{prefix}role">
    {#each ROLES as role (role)}
      <option selected={role === draft.role}>{role}</option>
    {/each}
  </select>
</label>
