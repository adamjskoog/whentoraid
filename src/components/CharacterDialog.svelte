<script>
  import { app } from '../lib/app.svelte.js'
  import { CLASS_NAMES, ROLES } from '../lib/constants.js'
  import { deleteCharacter, saveCharacter } from '../lib/model.js'
  import { showToast } from '../lib/toast.svelte.js'
  import Modal from './Modal.svelte'

  /** Add a character (`character` is null) or edit an existing one. */
  let { open, character, onclose } = $props()

  const draft = $derived(character ?? { name: '', realm: '', class: 'Warrior', spec: '', role: 'DPS' })

  /** Delete takes two clicks; the second one confirms. Resets whenever the dialog opens. */
  let confirmingDelete = $state(false)
  $effect(() => {
    if (open) confirmingDelete = false
  })

  function remove() {
    if (!confirmingDelete) {
      confirmingDelete = true
      return
    }
    // Read the name first: once deleted, the `character` prop becomes null.
    const { id, name } = character
    const result = deleteCharacter(app.data, app.data.currentMemberId, id)
    if (result.error) {
      showToast(result.error)
      confirmingDelete = false
      return
    }
    app.data = result.state
    onclose()
    showToast(`${name} deleted.`)
  }

  function submit(event) {
    event.preventDefault()
    const input = { ...Object.fromEntries(new FormData(event.currentTarget)), id: character?.id }
    const result = saveCharacter(app.data, app.data.currentMemberId, input)
    if (result.error) {
      showToast(result.error)
      return
    }
    app.data = result.state
    onclose()
    showToast('Character saved.')
  }
</script>

<Modal {open} {onclose}>
  <h2>{character ? 'Edit' : 'Add'} character</h2>
  <form onsubmit={submit}>
    <div class="settings-grid">
      <label class="field">Name<input name="name" required maxlength="30" value={draft.name} /></label>
      <label class="field">Realm<input name="realm" required maxlength="60" value={draft.realm} /></label>
      <label class="field">
        Class
        <select name="class">
          {#each CLASS_NAMES as name (name)}
            <option selected={name === draft.class}>{name}</option>
          {/each}
        </select>
      </label>
      <label class="field"
        >Specialization<input name="spec" required maxlength="40" value={draft.spec} /></label
      >
      <label class="field">
        Raid role
        <select name="role">
          {#each ROLES as role (role)}
            <option selected={role === draft.role}>{role}</option>
          {/each}
        </select>
      </label>
    </div>
    <div class="buttons">
      <button class="primary">Save character</button>
      {#if character}
        <button type="button" class:danger={confirmingDelete} onclick={remove}>
          {confirmingDelete ? 'Click again to delete' : 'Delete character'}
        </button>
      {/if}
    </div>
  </form>
</Modal>
