<script>
  import { app } from '../lib/app.svelte.js'
  import { ROLES, CLASS_NAMES } from '../lib/constants.js'
  import { characterById, charactersOf, memberById, preferredCharacter } from '../lib/model.js'
  import { benchGroups } from '../lib/planning.js'
  import PlayerCard from './PlayerCard.svelte'
  import CollapsibleSection from './CollapsibleSection.svelte'

  let {
    team,
    players,
    window,
    targets,
    onplace,
    onbench,
    onedit,
    onadd,
    locked = [],
    onlock,
    readonly = false,
  } = $props()
  let search = $state('')
  let filterRole = $state('')
  let filterClass = $state('')

  const BENCH_SECTIONS = [
    { key: 'available', title: 'Free for this session', empty: 'Nobody else can stay the whole session.' },
    { key: 'unavailable', title: 'Can’t make this session', empty: null },
    { key: 'waiting', title: 'Haven’t checked in', empty: null },
  ]

  const groups = $derived(benchGroups(players, window, team))
  const benchCount = $derived(Object.values(groups).reduce((sum, ids) => sum + ids.length, 0))

  function benchEntries(memberIds) {
    return memberIds
      .map((id) => {
        const matches = charactersOf(app.data, id).filter(
          (c) =>
            (!filterRole || c.role === filterRole) &&
            (!filterClass || c.class === filterClass) &&
            `${memberById(app.data, id)?.name} ${c.name} ${c.spec} ${c.class}`
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
        )
        const preferred = preferredCharacter(app.data, app.data.currentWeek, id)
        return matches.find((c) => c.id === preferred?.id) ?? matches[0]
      })
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
    if (readonly) return
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
          {readonly}
          onedit={() => onedit(entry.memberId)}
          onmove={(target) => move(entry, target)}
          locked={locked.includes(entry.memberId)}
          onlock={onlock && (() => onlock(entry.memberId))}
        />
      {/each}
      {#if !readonly && entries.length < targets[i]}
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
  <CollapsibleSection title={`On the bench ${benchCount}`}>
    <div class="settings-grid">
      <label class="field"
        >Search bench<input type="search" placeholder="Player or character name" bind:value={search} /></label
      >
      <label class="field"
        >Bench role<select bind:value={filterRole}
          ><option value="">All roles</option>{#each ROLES as role (role)}<option>{role}</option
            >{/each}</select
        ></label
      >
      <label class="field"
        >Bench class<select bind:value={filterClass}
          ><option value="">All classes</option>{#each CLASS_NAMES as cls (cls)}<option>{cls}</option
            >{/each}</select
        ></label
      >
    </div>
    {#if search || filterRole || filterClass}
      <p class="note" role="status">
        {Object.values(groups).flatMap(benchEntries).length} of {benchCount} players match.
        <button
          onclick={() => {
            search = ''
            filterRole = ''
            filterClass = ''
          }}>Clear filters</button
        >
      </p>
    {/if}
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
                {readonly}
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
  </CollapsibleSection>
</div>
