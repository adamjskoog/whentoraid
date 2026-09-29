<script>
  import { app } from '../lib/app.svelte.js'
  import { ROLES } from '../lib/constants.js'
  import { characterById, preferredCharacter } from '../lib/model.js'
  import { benchGroups } from '../lib/planning.js'
  import PlayerCard from './PlayerCard.svelte'

  let { team, players, window, targets, onplace, onbench, onedit, onadd, locked = [], onlock } = $props()

  const BENCH_SECTIONS = [
    { key: 'available', title: 'Free for this session', empty: 'Nobody else can stay the whole session.' },
    { key: 'unavailable', title: 'Can’t make this session', empty: null },
    { key: 'waiting', title: 'Haven’t checked in', empty: null },
  ]

  const groups = $derived(benchGroups(players, window, team))
  const benchCount = $derived(Object.values(groups).reduce((sum, ids) => sum + ids.length, 0))

  function benchEntries(memberIds) {
    return memberIds
      .map((id) => preferredCharacter(app.data, app.data.currentWeek, id))
      .filter(Boolean)
      .map((c) => ({ memberId: c.memberId, characterId: c.id, role: c.role }))
  }

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
    <h3>On the bench <span class="gold">{benchCount}</span></h3>
    <small>Drag to a role (press and hold on touch), or use + to add</small>
  </div>
  {#each BENCH_SECTIONS as section (section.key)}
    {@const entries = benchEntries(groups[section.key])}
    {#if entries.length || section.empty}
      <h4 class="bench-group">{section.title} <span>{entries.length}</span></h4>
      {#if entries.length}
        <div class="bench-list" class:dimmed={section.key !== 'available'}>
          {#each entries as entry (entry.memberId)}
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
      {:else}
        <p class="small-text">{section.empty}</p>
      {/if}
    {/if}
  {/each}
</div>
