<script>
  import { app } from '../lib/app.svelte.js'
  import { readCharacterFields } from '../lib/forms.js'
  import { retireCharacter, saveCharacter } from '../lib/model.js'
  import { offerUndo, showToast } from '../lib/toast.svelte.js'
  import CharacterFields from './CharacterFields.svelte'
  import Modal from './Modal.svelte'

  /** Add a character (`character` is null) or edit an existing one. */
  let { open, character, onclose } = $props()

  /** Delete takes two clicks; the second one confirms. Resets whenever the dialog opens. */
  let confirmingDelete = $state(false)
  let error = $state('')
  $effect(() => {
    if (open) {
      confirmingDelete = false
      error = ''
    }
  })

  function remove() {
    if (!confirmingDelete) {
      confirmingDelete = true
      return
    }
    // Read the name first: the dialog closes once the character is retired.
    const { id, name } = character
    const previous = app.data
    const result = retireCharacter(app.data, app.data.currentMemberId, id)
    if (result.error) {
      error = result.error
      confirmingDelete = false
      return
    }
    app.data = result.state
    onclose()
    offerUndo(`${name} deleted.`, previous)
  }

  function submit(event) {
    event.preventDefault()
    error = ''
    const input = { ...readCharacterFields(new FormData(event.currentTarget)), id: character?.id }
    const result = saveCharacter(app.data, app.data.currentMemberId, input)
    if (result.error) {
      error = result.error
      return
    }
    app.data = result.state
    onclose()
    showToast('Character saved.')
  }
</script>

<Modal {open} {onclose} label={`${character ? 'Edit' : 'Add'} character`}>
  <h2>{character ? 'Edit' : 'Add'} character</h2>
  <form onsubmit={submit}>
    <div class="settings-grid">
      <CharacterFields draft={character ?? undefined} />
    </div>
    {#if error}<p class="warning" role="alert">{error}</p>{/if}
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
