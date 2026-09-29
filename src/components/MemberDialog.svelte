<script>
  import { app } from '../lib/app.svelte.js'
  import { readCharacterFields } from '../lib/forms.js'
  import { addMember, removeMember, setOfficer, updateMember } from '../lib/members.js'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { offerUndo, showToast } from '../lib/toast.svelte.js'
  import CharacterFields from './CharacterFields.svelte'
  import Modal from './Modal.svelte'

  /** Add a player with their main character (`member` null), or edit/remove an existing one. */
  let { open, member, onclose } = $props()

  let error = $state('')
  /** Remove takes two clicks; the second one confirms. Both reset whenever the dialog opens. */
  let confirmingRemove = $state(false)
  $effect(() => {
    if (open) {
      error = ''
      confirmingRemove = false
    }
  })

  function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const input = {
      name: String(form.get('memberName') ?? ''),
      discordId: String(form.get('discordId') ?? ''),
    }
    const saved = member
      ? updateMember(app.data, member.id, input)
      : addMember(app.data, input, readCharacterFields(form, 'character-'))
    const officer = form.get('officer') === 'on'
    const result =
      remote.guildId && !saved.error && member && officer !== Boolean(member.officer)
        ? setOfficer(saved.state, member.id, officer)
        : saved
    if (result.error) {
      error = result.error
      return
    }
    app.data = result.state
    onclose()
    showToast(member ? 'Player saved.' : `${input.name.trim()} added to the guild.`)
  }

  function remove() {
    if (!confirmingRemove) {
      confirmingRemove = true
      return
    }
    const { id, name } = member
    const previous = app.data
    const result = removeMember(app.data, id)
    if (result.error) {
      error = result.error
      confirmingRemove = false
      return
    }
    app.data = result.state
    onclose()
    offerUndo(`${name} removed from the guild.`, previous)
  }
</script>

<Modal {open} {onclose}>
  <h2>{member ? `Edit ${member.name}` : 'Add a player'}</h2>
  <form onsubmit={submit}>
    <div class="settings-grid">
      <label class="field"
        >Player name<input name="memberName" required maxlength="30" value={member?.name ?? ''} /></label
      >
      <label class="field">
        Discord user ID (optional)
        <input
          name="discordId"
          inputmode="numeric"
          pattern="[0-9]*"
          placeholder="Lets reminders @mention them"
          value={member?.discordId ?? ''}
        />
      </label>
      {#if !member}
        <CharacterFields prefix="character-" />
      {/if}
    </div>
    {#if remote.guildId && member}
      <label class="checkbox-row">
        <input type="checkbox" name="officer" checked={Boolean(member.officer)} />
        Officer: can change guild settings, players, and rosters
      </label>
    {/if}
    {#if !member}
      <p class="small-text">This is their main. They can add alts on “My characters” once you act as them.</p>
    {/if}
    {#if error}
      <p class="note warning" role="alert">{error}</p>
    {/if}
    <div class="buttons form-actions">
      <button class="primary">{member ? 'Save player' : 'Add player'}</button>
      {#if member}
        <button type="button" class:danger={confirmingRemove} onclick={remove}>
          {confirmingRemove ? 'Click again to remove' : 'Remove from guild'}
        </button>
      {/if}
    </div>
    {#if confirmingRemove}
      <p class="note warning">This deletes their characters, availability, and roster history.</p>
    {/if}
  </form>
</Modal>
