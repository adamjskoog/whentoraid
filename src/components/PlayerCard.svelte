<script>
  import { app } from '../lib/app.svelte.js'
  import { CLASS_COLORS, ROLE_ICONS } from '../lib/constants.js'
  import { conflicts } from '../lib/engine.js'
  import { characterById, memberById } from '../lib/model.js'
  import { BENCH_LOOKBACK_WEEKS } from '../lib/planning.js'
  import { touchDrag } from '../lib/touch-drag.js'

  /**
   * `onmove(target)` handles a touch drop; target is a role name or "bench".
   * `onlock` is given only for rostered cards; locked players stay put when the roster is rebuilt.
   */
  let { entry, players, window, bench = false, onedit, onmove, locked = false, onlock } = $props()

  const member = $derived(memberById(app.data, entry.memberId))
  const character = $derived(characterById(app.data, entry.characterId))
  const problems = $derived(conflicts(entry, players, window))
  const satOut = $derived(players.find((p) => p.id === entry.memberId)?.priority ?? 0)

  function startDrag(event) {
    event.dataTransfer.setData(
      'text/plain',
      JSON.stringify({ memberId: entry.memberId, characterId: entry.characterId }),
    )
  }
</script>

{#if member && character}
  <div
    class="player"
    class:conflict={problems.length > 0}
    class:locked
    role="listitem"
    draggable="true"
    ondragstart={startDrag}
    use:touchDrag={{ ondrop: onmove }}
    style:--class={CLASS_COLORS[character.class] ?? '#aaa'}
  >
    <span class="mini" aria-hidden="true">{ROLE_ICONS[character.role]}</span>
    <div>
      <strong>{character.name}</strong>
      <small>{member.name} · {character.spec} {character.class}</small>
      {#if satOut > 0}
        <small class="sat-out">Sat out {satOut} of the last {BENCH_LOOKBACK_WEEKS} weeks</small>
      {/if}
      {#each problems as problem (problem)}
        <span class="warning">⚠ {problem}</span>
      {/each}
    </div>
    {#if onlock}
      <button
        class="lock"
        aria-pressed={locked}
        aria-label="{locked ? 'Unlock' : 'Lock'} {character.name}"
        title={locked ? 'Locked: stays when the roster is rebuilt' : 'Lock to keep through rebuilds'}
        onclick={onlock}>{locked ? '🔒' : '🔓'}</button
      >
    {/if}
    <button class="edit" aria-label="{bench ? 'Add' : 'Edit'} {character.name}" onclick={onedit}>
      {bench ? '+' : '⋯'}
    </button>
  </div>
{/if}
