<script>
  import { DAYS, ROLES } from '../lib/constants.js'
  import { isAvailable } from '../lib/engine.js'
  import { formatSlot } from '../lib/grid.js'
  import { focusCell, nextCell } from '../lib/grid-nav.js'
  import { formatMissing, missingRoles } from '../lib/planning.js'
  import WeekGrid from './WeekGrid.svelte'

  /**
   * Each cell describes a full session starting there. "Raid" (the default) shows how many role slots
   * the best roster for that start fills, which is what the planner ranks; a role view counts players
   * who can stay and offer that role; "Players" counts everyone who can stay. Cells too late in the day
   * to start a session show "–". Arrow keys move between cells; Enter or Space moves the roster there.
   */
  let { weekIso, grid, players, suggestions, targets, selection, durationSlots, onselect } = $props()

  const VIEWS = [
    { id: 'raid', label: 'Raid' },
    ...ROLES.map((role) => ({ id: role, label: role === 'DPS' ? 'Damage' : `${role}s` })),
    { id: 'players', label: 'Players' },
  ]
  const ROLE_NOUNS = { Tank: 'tanks', Healer: 'healers', DPS: 'damage dealers' }

  // Shade and text interpolate from an empty cell to a full cell.
  const EMPTY_RGB = [28, 38, 29]
  const FULL_RGB = [112, 164, 98]
  const DARK_TEXT_FROM = 0.6

  let view = $state('raid')
  /** The cell that takes Tab focus; null follows the selected session start. */
  let focused = $state(null)
  let container

  const totalSlots = $derived(targets.reduce((sum, n) => sum + n, 0))
  const eligible = $derived(players.filter((p) => p.checkedIn && p.characters.some((c) => c.offered)))
  const cells = $derived(new Map(suggestions.map((s) => [`${s.day}:${s.startSlot}`, describe(s)])))
  // Fall back to the selected start if the remembered cell no longer exists (fewer slots per day).
  const tabStop = $derived(
    focused && focused.slot < grid.slotsPerDay ? focused : { day: selection.day, slot: selection.startSlot },
  )

  function describe(suggestion) {
    if (view === 'raid') {
      const filled = suggestion.team.length
      const missing = formatMissing(missingRoles(suggestion.team, targets))
      return {
        text: filled,
        share: totalSlots ? filled / totalSlots : 0,
        full: filled === totalSlots,
        detail: `${filled} of ${totalSlots} slots filled · ${missing ?? 'full raid'}`,
      }
    }
    const pool = eligible.filter((p) => isAvailable(p, suggestion))
    if (view === 'players') {
      return {
        text: pool.length,
        share: players.length ? pool.length / players.length : 0,
        full: false,
        detail: `${pool.length} of ${players.length} can stay the full session`,
      }
    }
    const count = pool.filter((p) => p.characters.some((c) => c.offered && c.role === view)).length
    const need = targets[ROLES.indexOf(view)]
    return {
      text: count,
      share: need ? Math.min(count / need, 1) : Number(count > 0),
      full: need > 0 && count >= need,
      detail: `${count} ${ROLE_NOUNS[view]} can stay the full session (need ${need})`,
    }
  }

  function heatColor(share) {
    const channel = (i) => Math.round(EMPTY_RGB[i] + (FULL_RGB[i] - EMPTY_RGB[i]) * share)
    return `rgb(${channel(0)},${channel(1)},${channel(2)})`
  }

  function isChosen(day, slot) {
    return day === selection.day && slot >= selection.startSlot && slot < selection.startSlot + durationSlots
  }

  function navigate(event, day, slot) {
    const target = nextCell({ day, slot }, event.key, grid.slotsPerDay)
    if (!target) return
    event.preventDefault()
    focused = target
    focusCell(container, target)
  }
</script>

{#snippet cell(day, slot)}
  {@const info = cells.get(`${day}:${slot}`)}
  {@const label = info
    ? `${DAYS[day]} ${formatSlot(slot, grid)} start · ${info.detail}`
    : `${DAYS[day]} ${formatSlot(slot, grid)} · too late to start a full session`}
  <button
    class="cell"
    class:chosen={isChosen(day, slot)}
    class:no-start={!info}
    class:full={info?.full}
    class:dark-text={info && info.share >= DARK_TEXT_FROM}
    style:background={info ? heatColor(info.share) : null}
    data-day={day}
    data-slot={slot}
    tabindex={tabStop.day === day && tabStop.slot === slot ? 0 : -1}
    aria-label={label}
    title={label}
    onfocus={() => (focused = { day, slot })}
    onkeydown={(e) => navigate(e, day, slot)}
    onclick={() => onselect(day, slot)}>{info ? info.text || '·' : '–'}</button
  >
{/snippet}

<div class="heatmap-views buttons" role="group" aria-label="What the map shows">
  {#each VIEWS as option (option.id)}
    <button class="chip" aria-pressed={view === option.id} onclick={() => (view = option.id)}
      >{option.label}</button
    >
  {/each}
</div>
<div bind:this={container}>
  <WeekGrid {weekIso} {grid} {cell} />
</div>
<div class="legend">
  <span>
    {view === 'raid'
      ? 'Number = role slots the best roster fills for a session starting then. Gold border = full raid.'
      : view === 'players'
        ? 'Number = players who can stay for a full session starting then.'
        : `Number = ${ROLE_NOUNS[view]} who can stay for a full session starting then.`}
    Click, or use the arrow keys and Enter, to move the roster.
  </span>
  <span>Fewer <i></i> More</span>
</div>
