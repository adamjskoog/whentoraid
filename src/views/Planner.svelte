<script>
  import AddPlayerDialog from '../components/AddPlayerDialog.svelte'
  import AttendancePanel from '../components/AttendancePanel.svelte'
  import CheckinPanel from '../components/CheckinPanel.svelte'
  import Heatmap from '../components/Heatmap.svelte'
  import Modal from '../components/Modal.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import PlannerStats from '../components/PlannerStats.svelte'
  import PlayerDialog from '../components/PlayerDialog.svelte'
  import ReadinessPanel from '../components/ReadinessPanel.svelte'
  import RosterBoard from '../components/RosterBoard.svelte'
  import SuggestionCards from '../components/SuggestionCards.svelte'
  import WeekBar from '../components/WeekBar.svelte'
  import RaidSelector from '../components/RaidSelector.svelte'
  import WeeklyOverview from '../components/WeeklyOverview.svelte'
  import {
    copyPreviousRoster,
    hasDraftChanges,
    publishPlan,
    withdrawPlan,
    undoRosterChange,
  } from '../lib/raid-workflow.js'
  import { getRaid } from '../lib/raids.js'
  import { app } from '../lib/app.svelte.js'
  import { setAttendance, setCancelled } from '../lib/attendance.js'
  import { rosterIcs } from '../lib/calendar.js'
  import { ROLES } from '../lib/constants.js'
  import { downloadText } from '../lib/download.js'
  import { backups, conflicts, isAvailable } from '../lib/engine.js'
  import { displayZone } from '../lib/display.svelte.js'
  import { clampStartSlot, formatSessionIn, slotWindow } from '../lib/grid.js'
  import { characterById, getWeek, setPlan } from '../lib/model.js'
  import { canManage } from '../lib/remote/sync.svelte.js'
  import {
    benchMember,
    formatBackups,
    placeInRoster,
    plannerContext,
    rebuildTeam,
    toggleLock,
    topDistinctDays,
  } from '../lib/planning.js'
  import { DISCORD_MESSAGE_LIMIT, rosterDiscord, rosterText } from '../lib/roster-export.js'
  import { showToast, offerUndo } from '../lib/toast.svelte.js'

  let showPublished = $state(false)
  let undoChange = $state(null)
  const viewPublished = $derived(!canManage() || showPublished)
  const published = $derived(getWeek(app.data, app.data.currentWeek).plan?.published)

  const context = $derived(plannerContext(app.data))
  const plan = $derived(viewPublished && published ? { ...published, locked: [], saved: true } : context.plan)
  const players = $derived(context.players)
  const settings = $derived(
    viewPublished && published
      ? {
          ...getRaid(app.data),
          name: published.raidName,
          targets: published.targets,
          durationSlots: (published.end - published.start) / 1800000,
        }
      : getRaid(app.data),
  )
  const guild = $derived(app.data.guild)
  const weekIso = $derived(app.data.currentWeek)
  /** The saved plan carries attendance; the resolved plan above may be an unsaved suggestion. */
  const savedPlan = $derived(getWeek(app.data, weekIso).plan)
  const draftChanged = $derived(hasDraftChanges(app.data, context.plan))

  function rememberChange(previous, next) {
    undoChange = {
      week: weekIso,
      raidId: app.data.currentRaidId,
      before: $state.snapshot(getWeek(previous, weekIso).plan),
      after: $state.snapshot(getWeek(next, weekIso).plan),
    }
    app.data = next
  }

  function undoRoster() {
    if (officersOnly()) return
    const result = undoRosterChange(app.data, undoChange)
    if (result.error) return showToast(result.error)
    app.data = result.state
    undoChange = null
    showToast('Roster change undone.')
  }

  function copyLastWeek() {
    if (officersOnly()) return
    const result = copyPreviousRoster(app.data)
    if (result.error) return showToast(result.error)
    rememberChange(app.data, result.state)
    showToast(
      `Last week’s roster copied as a draft. Check this week’s availability.${result.dropped ? ` ${result.dropped} entries no longer fit and were left out.` : ''}`,
    )
  }

  function publish() {
    if (officersOnly()) return
    const previous = app.data
    const result = publishPlan(app.data, context.plan, players)
    if (result.error) return showToast(result.error)
    app.data = result.state
    offerUndo('Roster published. Draft edits will stay separate.', previous)
  }

  function withdraw() {
    if (officersOnly()) return
    const previous = app.data
    app.data = withdrawPlan(app.data)
    showPublished = false
    offerUndo('Published roster withdrawn. Your draft is kept.', previous)
  }

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
  const zone = $derived(displayZone(guild))
  const sessionLabel = $derived(formatSessionIn(plan, zone))
  const benchMembers = $derived(app.data.members.filter((m) => !plan.team.some((e) => e.memberId === m.id)))
  const planBackups = $derived(backups(players, plan, plan.team))
  const planThinnest = $derived(
    Math.min(...planBackups.filter((_, i) => settings.targets[i] > 0).concat(Number.POSITIVE_INFINITY)),
  )

  /** @type {{ kind: 'player', memberId: string, role?: string } | { kind: 'add', role: string } | null} */
  let dialog = $state(null)

  /** Rosters and attendance are officers' calls in an online guild; the server enforces it too. */
  function officersOnly() {
    if (canManage()) return false
    showToast('Only officers can change the roster.')
    return true
  }

  /** Locks carry over unless given; setPlan drops locks for anyone no longer on the team. */
  function savePlan(start, team, locked = plan.locked) {
    if (officersOnly() || viewPublished) return
    rememberChange(app.data, setPlan(app.data, weekIso, { start, team, locked }))
  }

  function rebuild() {
    if (officersOnly()) return
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

  /** Attendance lives on the saved plan, so an unsaved suggestion is saved first. */
  function ensureSaved() {
    if (!plan.saved) savePlan(plan.start, plan.team)
  }

  function markAttendance(memberId, status) {
    if (officersOnly()) return
    ensureSaved()
    app.data = setAttendance(app.data, weekIso, memberId, status)
  }

  function markCancelled(cancelled) {
    if (officersOnly()) return
    ensureSaved()
    app.data = setCancelled(app.data, weekIso, cancelled)
    showToast(cancelled ? 'Raid marked as cancelled' : 'Raid marked as held')
  }

  /** Text to copy by hand when the clipboard API is unavailable (e.g. not a secure context). */
  let manualCopyText = $state(null)

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      manualCopyText = text
      return
    }
    showToast(
      text.length > DISCORD_MESSAGE_LIMIT
        ? `Copied, but it is ${text.length} characters, over Discord's ${DISCORD_MESSAGE_LIMIT}-character limit. Paste it in two messages.`
        : successMessage,
    )
  }

  function copyForDiscord() {
    copyText(rosterDiscord(app.data, plan, players), 'Roster copied. Paste it into Discord.')
  }

  function exportRoster() {
    downloadText(`whentoraid-${settings.id}-${weekIso}.txt`, rosterText(app.data, plan, players))
  }

  function exportCalendar() {
    downloadText(`whentoraid-${settings.id}-${weekIso}.ics`, rosterIcs(app.data, plan), 'text/calendar')
  }
</script>

<PageTitle
  eyebrow="MAKE TIME FOR THE ADVENTURE"
  title="Find your next raid night."
  subtitle="Real lives. Different schedules. One raid team."
/>

<WeekBar />
<RaidSelector />
<WeeklyOverview publishedOnly={viewPublished} />
<section class="panel spaced-top" aria-label="Roster publication">
  <div class="buttons">
    {#if canManage()}
      <button aria-pressed={!viewPublished} onclick={() => (showPublished = false)}>Edit draft</button>
      <button aria-pressed={viewPublished} onclick={() => (showPublished = true)}
        >View published roster</button
      >
      {#if !viewPublished}
        <button class="primary" disabled={published && !draftChanged} onclick={publish}
          >{published ? 'Publish draft changes' : 'Publish roster'}</button
        >
      {/if}
      {#if published}<button onclick={withdraw}>Withdraw published roster</button>{/if}
    {/if}
  </div>
  <p role="status" class="note">
    {!published
      ? 'No published roster for this raid yet.'
      : draftChanged
        ? 'Published roster is available. Draft changes have not been published.'
        : 'The draft matches the published roster.'}
    {viewPublished ? 'Viewing the confirmed roster.' : 'Editing the draft.'}
  </p>
  {#if savedPlan?.cancelled}<p class="warning">This raid is cancelled.</p>{/if}
</section>
{#if app.data.demoYear}
  <p class="note">
    Demo guild · Randomized availability and raid plans for all of {app.data.demoYear}. Load the demo again
    for a fresh year of sample data.
  </p>
{/if}

{#if !viewPublished || published}
  <PlannerStats
    {checkedInCount}
    playerCount={players.length}
    rosterCount={plan.team.length}
    {totalSlots}
    {roleCounts}
    {problemCount}
  />

  <div class="workspace">
    <div>
      {#if !viewPublished}
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
        <div class="buttons spaced-top">
          <button onclick={copyLastWeek}>Copy last week’s roster</button>
          <button
            disabled={!undoChange ||
              undoChange.week !== weekIso ||
              undoChange.raidId !== app.data.currentRaidId}
            onclick={undoRoster}>Undo roster change</button
          >
        </div>

        <SuggestionCards
          suggestions={topDays}
          {checkedInCount}
          {totalSlots}
          targets={settings.targets}
          selectedStart={plan.start}
          {zone}
          onchoose={chooseSuggestion}
        />

        <div class="panel">
          <div class="section-head">
            <h3>Guild availability</h3>
            <small>Every cell is a full session starting at that time</small>
          </div>
          <Heatmap
            {weekIso}
            grid={guild}
            {players}
            suggestions={context.suggestions}
            targets={settings.targets}
            selection={plan}
            durationSlots={settings.durationSlots}
            onselect={moveSession}
          />
        </div>
      {/if}

      <div class="section-head roster-header">
        <div>
          <h2>Your raid roster</h2>
          <p class="note">{settings.name}</p>
          <small
            >{sessionLabel} · {viewPublished
              ? 'Published roster'
              : 'Draft · changes save automatically'}</small
          >
          {#if !viewPublished}<small>Open a player’s ⋯ menu for eligibility and recent bench priority.</small
            >{/if}
        </div>
        <div class="buttons">
          <button onclick={copyForDiscord}>Copy for Discord</button>
          <button onclick={exportCalendar}>Add to calendar (.ics)</button>
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
        readonly={viewPublished}
      />

      {#if plan.team.length && !viewPublished}
        <AttendancePanel
          team={plan.team}
          attendance={savedPlan?.attendance ?? {}}
          cancelled={savedPlan?.cancelled ?? false}
          onmark={markAttendance}
          oncancelled={markCancelled}
        />
      {/if}
    </div>

    <div>
      <CheckinPanel oncopy={copyText} />

      <ReadinessPanel
        {sessionLabel}
        {roleCounts}
        targets={settings.targets}
        {availableCount}
        backupsLabel={formatBackups(planBackups)}
        backupsOk={planThinnest > 0}
        lockedCount={plan.locked.length}
        {problemCount}
        {classCount}
      />
    </div>
  </div>
{/if}

<AddPlayerDialog
  open={dialog?.kind === 'add'}
  role={dialog?.kind === 'add' ? dialog.role : null}
  {benchMembers}
  onchoose={(memberId) => (dialog = { kind: 'player', memberId, role: dialog.role })}
  onclose={() => closeDialog('add')}
/>

<PlayerDialog
  {plan}
  {players}
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
