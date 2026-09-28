<script>
  import CharacterDialog from '../components/CharacterDialog.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import { app } from '../lib/app.svelte.js'
  import { CLASS_COLORS } from '../lib/constants.js'
  import { characterById, charactersOf, setMainCharacter } from '../lib/model.js'
  import { showToast } from '../lib/toast.svelte.js'

  function makeMain(character) {
    app.data = setMainCharacter(app.data, app.data.currentMemberId, character.id)
    showToast(`${character.name} is now your main.`)
  }

  /** null: dialog closed. { characterId: null }: adding. { characterId }: editing. */
  let editing = $state(null)

  const myCharacters = $derived(charactersOf(app.data, app.data.currentMemberId))
  const editingCharacter = $derived(
    editing?.characterId ? characterById(app.data, editing.characterId) : null,
  )
</script>

<PageTitle
  eyebrow="YOUR ADVENTURERS"
  title="One player. Many possibilities."
  subtitle="Character details are entered manually in this prototype."
>
  {#snippet action()}
    <button class="primary" onclick={() => (editing = { characterId: null })}>+ Add character</button>
  {/snippet}
</PageTitle>

<div class="character-list">
  {#each myCharacters as character (character.id)}
    <div class="character-card" style:--class={CLASS_COLORS[character.class]}>
      <span class="badge">{character.main ? 'MAIN' : 'ALT'}</span>
      <h2>{character.name}</h2>
      <p>{character.spec} {character.class}</p>
      <small>{character.realm} · {character.role}</small>
      <small>Gear: not synced</small>
      <div class="buttons spaced-top">
        <button onclick={() => (editing = { characterId: character.id })}>Edit character</button>
        {#if !character.main}
          <button onclick={() => makeMain(character)}>Make main</button>
        {/if}
      </div>
    </div>
  {/each}
</div>

<p class="note">
  WoW: Forever character import is not yet verified. Manual profiles let your guild plan before API support is
  confirmed.
</p>

<CharacterDialog open={editing !== null} character={editingCharacter} onclose={() => (editing = null)} />
