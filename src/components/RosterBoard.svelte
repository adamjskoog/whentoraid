<script>
  import { app } from '../lib/app.svelte.js'
  import { ROLES } from '../lib/constants.js'
  import { characterById, preferredCharacter } from '../lib/model.js'
  import PlayerCard from './PlayerCard.svelte'

  let { team, players, window, targets, onplace, onbench, onedit, onadd, locked = [], onlock } = $props()

  const used = $derived(new Set(team.map((e) => e.memberId)))
  const benchEntries = $derived(
    app.data.members
      .filter((m) => !used.has(m.id))
      .map((m) => preferredCharacter(app.data, app.data.currentWeek, m.id))
      .filter(Boolean)
      .map((c) => ({ memberId: c.memberId, characterId: c.id, role: c.role })),
  )

  function roleHeading(role) {
    return role === 'DPS' ? 'DAMAGE' : `${role.toUpperCase()}S`
  }

  function readDrop(event) {
    try {
      const entry = JSON.parse(event.dataTransfer.getData('text/plain'))
      const character = characterById(app.data, entry?.characterId)
      return character && character.memberId === entry.memberId ? entry : null
    } catch {
      return null
    }
  }

  /** Mouse drops (native drag-and-drop) and touch drops (touchDrag) both end here. */
  function move(entry, target) {
    if (target === 'bench') onbench(entry.memberId)
    else onplace(entry.memberId, entry.characterId, target)
  }

  function dropNative(event, target) {
    event.preventDefault()
    const entry = readDrop(event)
    if (entry) move(entry, target)
  }
</script>

<div class="role-columns">
  {#each ROLES as role, i (role)}
    {@const entries = team.filter((e) => e.role === role)}
    <section
      aria-label="{role} slots"
      data-drop={role}
      ondragover={(e) => e.preventDefault()}
      ondrop={(e) => dropNative(e, role)}
    >
      <div class="role-title">{roleHeading(role)} <b>{entries.length} / {targets[i]}</b></div>
      {#each entries as entry (entry.memberId)}
        <PlayerCard
          {entry}
          {players}
          {window}
          onedit={() => onedit(entry.memberId)}
          onmove={(target) => move(entry, target)}
          locked={locked.includes(entry.memberId)}
          onlock={onlock && (() => onlock(entry.memberId))}
        />
      {/each}
      {#if entries.length < targets[i]}
        <button class="empty-slot" onclick={() => onadd(role)}>
          + Add {role.toLowerCase()} · {targets[i] - entries.length} open
        </button>
      {/if}
    </section>
  {/each}
</div>

<div
  class="bench"
  role="region"
  aria-label="Bench"
  data-drop="bench"
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => dropNative(e, 'bench')}
>
  <div class="section-head">
    <h3>On the bench <span class="gold">{app.data.members.length - used.size}</span></h3>
    <small>Drag to a role (press and hold on touch), or use + to add</small>
  </div>
  <div class="bench-list">
    {#each benchEntries as entry (entry.memberId)}
      <PlayerCard
        {entry}
        {players}
        {window}
        bench
        onedit={() => onedit(entry.memberId)}
        onmove={(target) => move(entry, target)}
      />
    {/each}
  </div>
</div>
