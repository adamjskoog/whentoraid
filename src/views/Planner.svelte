<script>
  import AddPlayerDialog from '../components/AddPlayerDialog.svelte'
  import Heatmap from '../components/Heatmap.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import PlayerDialog from '../components/PlayerDialog.svelte'
  import RosterBoard from '../components/RosterBoard.svelte'
  import WeekBar from '../components/WeekBar.svelte'
  import { app } from '../lib/app.svelte.js'
  import { DAYS, ROLES } from '../lib/constants.js'
  import { backups, conflicts, isAvailable } from '../lib/engine.js'
  import { clampStartSlot, formatSession, formatSlot, slotWindow } from '../lib/grid.js'
  import { characterById, setPlan } from '../lib/model.js'
  import {
    benchMember,
    placeInRoster,
    plannerContext,
    rebuildTeam,
    toggleLock,
    topDistinctDays,
  } from '../lib/planning.js'
  import Modal from '../components/Modal.svelte'
  import { DISCORD_MESSAGE_LIMIT, rosterDiscord, rosterText } from '../lib/roster-export.js'
  import { addDays, formatMonthDay } from '../lib/time.js'
  import { showToast } from '../lib/toast.svelte.js'

  const DOWNLOAD_URL_LIFETIME_MS = 1000

  const context = $derived(plannerContext(app.data))
  const plan = $derived(context.plan)
  const players = $derived(context.players)
  const settings = $derived(app.data.settings)
  const guild = $derived(app.data.guild)
  const weekIso = $derived(app.data.currentWeek)

  const totalSlots = $derived(settings.targets.reduce((sum, n) => sum + n, 0))
  const roleCounts = $derived(ROLES.map((role) => plan.team.filter((e) => e.role === role).length))
  const checkedInCount = $derived(players.filter((p) => p.checkedIn).length)
  const availableCount = $derived(
    players.filter((p) => isAvailable(p, plan) && p.characters.some((c) => c.offered)).length,
  )
  const problemCount = $derived(plan.team.filter((e) => conflicts(e, players, plan).length > 0).length)
  const topDays = $derived(topDistinctDays(context.suggestions, 3))
  const classCount = $derived(
    new Set(plan.team.map((e) => characterById(app.data, e.characterId)?.class)).size,
  )
  const sessionLabel = $derived(formatSession(plan.day, plan.startSlot, settings.durationSlots, guild))
  const benchMembers = $derived(app.data.members.filter((m) => !plan.team.some((e) => e.memberId === m.id)))
  const planBackups = $derived(backups(players, plan, plan.team))
  const planThinnest = $derived(
    Math.min(...planBackups.filter((_, i) => settings.targets[i] > 0).concat(Number.POSITIVE_INFINITY)),
  )

  const ROLE_LETTERS = { Tank: 'T', Healer: 'H', DPS: 'D' }

  function formatBackups(spare) {
    return ROLES.map((role, i) => `${spare[i]} ${ROLE_LETTERS[role]}`).join(' · ')
  }

  /** @type {{ kind: 'player', memberId: string, role?: string } | { kind: 'add', role: string } | null} */
  let dialog = $state(null)

  /** Locks carry over unless given; setPlan drops locks for anyone no longer on the team. */
  function savePlan(start, team, locked = plan.locked) {
    app.data = setPlan(app.data, weekIso, { start, team, locked })
  }

  function rebuild() {
    savePlan(plan.start, rebuildTeam(players, plan, settings.targets, plan.team, plan.locked))
    showToast(plan.locked.length ? 'Roster rebuilt around locked players' : 'Roster rebuilt for this session')
  }

  function chooseSuggestion(suggestion) {
    const team = plan.locked.length
      ? rebuildTeam(players, suggestion, settings.targets, plan.team, plan.locked)
      : suggestion.team
    savePlan(suggestion.start, team)
  }

  function lock(memberId) {
    savePlan(plan.start, plan.team, toggleLock(plan.locked, memberId))
  }

  function moveSession(day, slot) {
    const startSlot = clampStartSlot(slot, settings.durationSlots, guild)
    savePlan(slotWindow(weekIso, day, startSlot, settings.durationSlots, guild).start, plan.team)
  }

  function place(memberId, characterId, role) {
    const result = placeInRoster(plan.team, { memberId, characterId, role }, settings.targets)
    if ('error' in result) {
      showToast(result.error)
      return
    }
    savePlan(plan.start, result.team)
  }

  function bench(memberId) {
    savePlan(plan.start, benchMember(plan.team, memberId))
  }

  function pickCharacter(character) {
    const role = dialog?.kind === 'player' && dialog.role ? dialog.role : character.role
    dialog = null
    place(character.memberId, character.id, role)
  }

  function benchFromDialog() {
    if (dialog?.kind === 'player') bench(dialog.memberId)
    dialog = null
  }

  // Each dialog clears only its own state, so switching from "add" to "player" is not undone by the close event.
  function closeDialog(kind) {
    if (dialog?.kind === kind) dialog = null
  }

  /** Text to copy by hand when the clipboard API is unavailable (e.g. not a secure context). */
  let manualCopyText = $state(null)

  async function copyForDiscord() {
    const text = rosterDiscord(app.data, plan, players)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      manualCopyText = text
      return
    }
    showToast(
      text.length > DISCORD_MESSAGE_LIMIT
        ? `Copied, but it is ${text.length} characters, over Discord's ${DISCORD_MESSAGE_LIMIT}-character limit. Paste it in two messages.`
        : 'Roster copied. Paste it into Discord.',
    )
  }

  function exportRoster() {
    const blob = new Blob([rosterText(app.data, plan, players)], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `whentoraid-${weekIso}.txt`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS)
  }
</script>

<PageTitle
  eyebrow="MAKE TIME FOR THE ADVENTURE"
  title="Find your next raid night."
  subtitle="Real lives. Different schedules. One raid team."
>
  {#snippet action()}
    <span class="badge">OFFICER PREVIEW</span>
  {/snippet}
</PageTitle>

<WeekBar />

<div class="stats">
  <div class="stat">
    <span class="stat-label">WEEKLY CHECK-INS</span>
    <strong>{checkedInCount} <span>/ {players.length}</span></strong>
    <small>Players who checked in this week</small>
  </div>
  <div class="stat">
    <span class="stat-label">CURRENT ROSTER</span>
    <strong>{plan.team.length} <span>/ {totalSlots}</span></strong>
    <small>{roleCounts[0]} tanks · {roleCounts[1]} healers · {roleCounts[2]} damage</small>
  </div>
  <div class="stat">
    <span class="stat-label">SCHEDULE CONFLICTS</span>
    <strong class={problemCount ? 'bad' : 'good'}>{String(problemCount).padStart(2, '0')}</strong>
    <small
      >{problemCount ? 'Review highlighted players below' : 'Everyone selected can make this session'}</small
    >
  </div>
</div>

<div class="workspace">
  <div>
    <div class="section-head">
      <div>
        <h2>The best windows</h2>
        <small>
          Ranked by role slots filled, then backups for the thinnest role, then who sat out recently, then
          mains.
        </small>
      </div>
      <button onclick={rebuild}>↻ Rebuild roster</button>
    </div>

    <div class="candidates">
      {#each topDays as suggestion, i (suggestion.day)}
        <button
          class="candidate"
          class:selected={suggestion.start === plan.start}
          onclick={() => chooseSuggestion(suggestion)}
        >
          <span class="rank">{i === 0 ? '✦ TOP SUGGESTION' : `ALTERNATIVE 0${i}`}</span>
          <b>{DAYS[suggestion.day]} {formatMonthDay(addDays(weekIso, suggestion.day))}</b>
          <small>
            {formatSlot(suggestion.startSlot, guild)} – {formatSlot(
              suggestion.startSlot + settings.durationSlots,
              guild,
            )}
          </small>
          <span class="count">{suggestion.team.length} / {totalSlots} roles filled</span>
          <small class="backups">Backups: {formatBackups(suggestion.backups)}</small>
        </button>
      {/each}
    </div>

    <div class="panel">
      <div class="section-head">
        <h3>Guild availability</h3>
        <small>Counts are for a full session starting at each time</small>
      </div>
      <Heatmap
        {weekIso}
        grid={guild}
        {players}
        windows={context.windows}
        selection={plan}
        durationSlots={settings.durationSlots}
        onselect={moveSession}
      />
    </div>

    <div class="section-head roster-header">
      <div>
        <h2>Your raid roster</h2>
        <small>{sessionLabel} · Changes save automatically</small>
      </div>
      <div class="buttons">
        <button onclick={copyForDiscord}>Copy for Discord</button>
        <button onclick={exportRoster}>Download .txt ↓</button>
      </div>
    </div>

    <RosterBoard
      team={plan.team}
      {players}
      window={plan}
      targets={settings.targets}
      onplace={place}
      onbench={bench}
      onedit={(memberId) => (dialog = { kind: 'player', memberId })}
      onadd={(role) => (dialog = { kind: 'add', role })}
      locked={plan.locked}
      onlock={lock}
    />
  </div>

  <div>
    <section class="panel side-section">
      <span class="eyebrow gold">RAID READINESS</span>
      <h2 class="readiness-heading">A party with a plan.</h2>
      <p>{sessionLabel}</p>
      {#each ROLES as role, i (role)}
        {@const full = roleCounts[i] === settings.targets[i]}
        <div class="check">
          <span>{role} slots</span>
          <span class={full ? 'ok' : 'gold'}>{roleCounts[i]} / {settings.targets[i]} {full ? '✓' : ''}</span>
        </div>
      {/each}
      <div class="check"><span>Available players</span><span>{availableCount}</span></div>
      <div class="check"><span>Unique players</span><span class="ok">{plan.team.length} ✓</span></div>
      <div class="check">
        <span>Backups (tank · healer · damage)</span>
        <span class={planThinnest > 0 ? 'ok' : 'gold'}>{formatBackups(planBackups)}</span>
      </div>
      <div class="check"><span>Locked players</span><span>{plan.locked.length}</span></div>
      <div class="check">
        <span>Availability conflicts</span>
        <span class={problemCount ? 'warning' : 'ok'}>{problemCount ? 'Review required' : 'All clear ✓'}</span
        >
      </div>
      <p class="note">
        {problemCount
          ? 'Your roster is kept when you change times. Highlighted players cannot attend the full session.'
          : 'Move a player between roles or bring an alt. The planner checks every change.'}
      </p>
    </section>

    <section class="panel side-section">
      <span class="eyebrow">COMPOSITION NOTES</span>
      <p class="small-text">
        This first pass balances roles and attendance. Encounter-specific buffs, resistances, and player
        experience still need officer judgment.
      </p>
      <div class="check"><span>Classes represented</span><span>{classCount}</span></div>
      <button class="full-width" onclick={() => (app.view = 'settings')}>Adjust raid requirements</button>
    </section>

    <section>
      <p class="eyebrow">NO FIXED RAID NIGHT REQUIRED</p>
      <p class="small-text">
        Start a fresh week. Let your guild check in. Find the night that works for your people.
      </p>
    </section>
  </div>
</div>

<AddPlayerDialog
  open={dialog?.kind === 'add'}
  role={dialog?.kind === 'add' ? dialog.role : null}
  {benchMembers}
  onchoose={(memberId) => (dialog = { kind: 'player', memberId, role: dialog.role })}
  onclose={() => closeDialog('add')}
/>

<PlayerDialog
  open={dialog?.kind === 'player'}
  memberId={dialog?.kind === 'player' ? dialog.memberId : null}
  inTeam={dialog?.kind === 'player' && plan.team.some((e) => e.memberId === dialog.memberId)}
  onpick={pickCharacter}
  onbench={benchFromDialog}
  onclose={() => closeDialog('player')}
/>

<Modal open={manualCopyText !== null} onclose={() => (manualCopyText = null)}>
  <h2>Copy for Discord</h2>
  <p>Your browser blocked clipboard access. Select the text below and copy it.</p>
  <textarea
    class="copy-box"
    readonly
    rows="14"
    value={manualCopyText}
    onfocus={(e) => e.currentTarget.select()}></textarea>
</Modal>
