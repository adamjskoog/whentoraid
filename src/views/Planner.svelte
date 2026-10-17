<script>
  import SectionTabs from '../components/SectionTabs.svelte'
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
  import RaidResponsesPanel from '../components/RaidResponsesPanel.svelte'
  import SignupsPanel from '../components/SignupsPanel.svelte'
  import WeeklyOverview from '../components/WeeklyOverview.svelte'
  import {
    copyPreviousRoster,
    hasDraftChanges,
    publishPlan,
    withdrawPlan,
    undoRosterChange,
    publicationChanges,
    publicationIssues,
  } from '../lib/raid-workflow.js'
  import { getRaid, setCurrentRaid } from '../lib/raids.js'
  import { app } from '../lib/app.svelte.js'
  import { markAllAttended, setAttendance, setCancelled } from '../lib/attendance.js'
  import { rosterIcs } from '../lib/calendar.js'
  import { ROLES } from '../lib/constants.js'
  import { downloadText } from '../lib/download.js'
  import { backups, conflicts, isAvailable } from '../lib/engine.js'
  import { displayZone, viewerZone } from '../lib/display.svelte.js'
  import { clampStartSlot, formatSessionHeading, formatSessionIn, slotWindow } from '../lib/grid.js'
  import {
    characterById,
    memberById,
    getWeek,
    setCurrentWeek,
    setPlan,
    tracksAttendance,
  } from '../lib/model.js'
  import { canManage, remote } from '../lib/remote/sync.svelte.js'
  import {
    benchMember,
    formatBackups,
    placeInRoster,
    plannerContext,
    readyRoleCounts,
    rebuildTeam,
    retimeTeam,
    toggleLock,
    topDistinctDays,
  } from '../lib/planning.js'
  import { rosterDiscord, rosterMentions, rosterText, splitForDiscord } from '../lib/roster-export.js'
  import {
    discordChannel,
    hasDiscordChannel,
    loadDiscordChannel,
    postKey,
    rememberPost,
  } from '../lib/discord-channel.svelte.js'
  import { compositionIssues } from '../lib/composition-rules.js'
  import { publishedRosterUrl } from '../lib/route.js'
  import { deleteFromWebhook, postToWebhook } from '../lib/discord-webhook.js'
  import { showToast, offerUndo } from '../lib/toast.svelte.js'
  import { loadRaidResponses, responseKey } from '../lib/raid-responses.svelte.js'
  import {
    delivery,
    deliveryKey,
    deliveryStatus,
    needsRetry,
    queueAndSend,
    refreshDelivery,
    retryDelivery,
    sendQueued,
    usesServerDelivery,
    watchDelivery,
  } from '../lib/discord-delivery.svelte.js'

  let activeSection = $state('schedule')
  let showPublished = $state(false)
  const section = $derived(
    !canManage() || (viewPublished && activeSection === 'schedule') ? 'roster' : activeSection,
  )
  // A personal assignment or shared roster link opens the published roster, even if already here.
  $effect(() => {
    if (app.plannerIntent !== 'published') return
    showPublished = true
    activeSection = 'roster'
    app.plannerIntent = null
  })
  const tabs = $derived([
    ...(!viewPublished ? [{ id: 'schedule', label: 'Schedule' }] : []),
    { id: 'roster', label: 'Roster', count: plan.team.length },
    ...(canManage() ? [{ id: 'responses', label: 'Responses' }] : []),
  ])
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
  const changes = $derived(publicationChanges(app.data, context.plan))
  const issues = $derived(publicationIssues(app.data, context.plan, players))
  let showIssues = $state(false)
  let replacementTarget = $state(null)
  const replacementEntry = $derived(context.plan.team.find((entry) => entry.memberId === replacementTarget))
  const replacements = $derived(
    replacementEntry
      ? players
          .filter(
            (player) =>
              !context.plan.team.some((entry) => entry.memberId === player.id) &&
              isAvailable(player, context.plan),
          )
          .flatMap((player) =>
            player.characters
              .filter((character) => character.offered && character.role === replacementEntry.role)
              .map((character) => ({ player, character })),
          )
      : [],
  )

  /** Officers see how players answered the published roster; republishing asks everyone again. */
  let responses = $state({ key: null, byMember: {}, error: '', checkedAt: null })
  let checkingResponses = $state(false)
  /** Bumped to fetch again: responses are not part of live guild sync. */
  let responsesTick = $state(0)
  const responsesKey = $derived(published ? responseKey(weekIso, app.data.currentRaidId, published) : null)
  $effect(() => {
    const key = responsesKey
    void responsesTick
    if (!key || !canManage()) return
    const raidId = app.data.currentRaidId
    checkingResponses = true
    loadRaidResponses(weekIso, raidId, published)
      .then((byMember) => {
        if (key === responsesKey) responses = { key, byMember, error: '', checkedAt: Date.now() }
      })
      .catch((error) => {
        // Keep the last answers on screen when a background refresh fails.
        if (key === responsesKey)
          responses = {
            ...responses,
            key,
            byMember: responses.key === key ? responses.byMember : {},
            error: error.message,
          }
      })
      .finally(() => {
        if (key === responsesKey) checkingResponses = false
      })
  })
  /** Check again every minute while officers watch the Responses tab and the page is visible. */
  const RESPONSES_REFRESH_MS = 60_000
  $effect(() => {
    if (section !== 'responses' || !responsesKey || !canManage()) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') responsesTick += 1
    }, RESPONSES_REFRESH_MS)
    return () => clearInterval(timer)
  })
  const inDraft = (memberId) => context.plan.team.some((entry) => entry.memberId === memberId)

  function replaceMember(memberId) {
    showPublished = false
    replacementTarget = memberId
  }

  function confirmReplacement(memberId, characterId) {
    const result = placeInRoster(
      benchMember(context.plan.team, replacementTarget),
      { memberId, characterId, role: replacementEntry.role },
      getRaid(app.data).targets,
    )
    if (result.error) return showToast(result.error)
    rememberChange(
      app.data,
      setPlan(app.data, weekIso, {
        start: context.plan.start,
        team: result.team,
        locked: context.plan.locked.filter((id) => id !== replacementTarget),
      }),
    )
    replacementTarget = null
    showToast('Replacement saved in the draft. Review and publish the change when ready.')
  }

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
    showIssues = true
    const previous = app.data
    const result = publishPlan(app.data, context.plan, players)
    if (result.error) return showToast(result.error)
    app.data = result.state
    showIssues = false
    offerUndo('Roster published. Draft edits will stay separate.', previous)
    if (!hasDiscordChannel()) return
    // A roster already in Discord follows what was just published; a new one is posted unless unticked.
    if (postedIds.length) void followPublication(postToDiscord)
    else if (postOnPublish) void postToDiscord()
  }

  function withdraw() {
    if (officersOnly()) return
    const previous = app.data
    app.data = withdrawPlan(app.data)
    showPublished = false
    offerUndo('Published roster withdrawn. Your draft is kept.', previous)
    if (hasDiscordChannel() && postedIds.length) void followPublication(withdrawDiscordPost)
  }

  const totalSlots = $derived(settings.targets.reduce((sum, n) => sum + n, 0))
  const roleCounts = $derived(ROLES.map((role) => plan.team.filter((e) => e.role === role).length))
  const readyCounts = $derived(readyRoleCounts(plan.team, players, plan))
  const checkedInCount = $derived(players.filter((p) => p.checkedIn).length)
  const availableCount = $derived(
    players.filter((p) => isAvailable(p, plan) && p.characters.some((c) => c.offered)).length,
  )
  const problemCount = $derived(plan.team.filter((e) => conflicts(e, players, plan).length > 0).length)
  const topDays = $derived(topDistinctDays(context.suggestions, 3))
  const classCount = $derived(
    new Set(plan.team.map((e) => characterById(app.data, e.characterId)?.class)).size,
  )
  /** The raid's optional class limits and required utilities, as warnings officers may accept. */
  const ruleIssues = $derived(
    compositionIssues(
      plan.team,
      players.flatMap((p) => p.characters),
      settings.rules,
    ),
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
    savePlan(plan.start, rebuildTeam(players, plan, settings.targets, plan.team, plan.locked, settings.rules))
    showToast(plan.locked.length ? 'Roster rebuilt around locked players' : 'Roster rebuilt for this session')
  }

  function chooseSuggestion(suggestion) {
    const team = plan.locked.length
      ? rebuildTeam(players, suggestion, settings.targets, plan.team, plan.locked, settings.rules)
      : suggestion.team
    savePlan(suggestion.start, team)
  }

  function lock(memberId) {
    savePlan(plan.start, plan.team, toggleLock(plan.locked, memberId))
  }

  /** Moving the session keeps who can still come (and locked players) and refills the rest. */
  function moveSession(day, slot) {
    if (officersOnly() || viewPublished) return
    const startSlot = clampStartSlot(slot, settings.durationSlots, guild)
    const window = slotWindow(weekIso, day, startSlot, settings.durationSlots, guild)
    const { team, replaced } = retimeTeam(
      players,
      window,
      settings.targets,
      plan.team,
      plan.locked,
      settings.rules,
    )
    savePlan(window.start, team)
    if (replaced) {
      showToast(
        `${replaced} ${replaced === 1 ? 'player' : 'players'} who can’t make this time moved to the bench, and open slots were refilled. “Undo roster change” puts them back.`,
      )
    }
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

  function markEveryone() {
    if (officersOnly()) return
    const previous = app.data
    ensureSaved()
    const next = markAllAttended(app.data, weekIso)
    rememberChange(previous, next)
    offerUndo('Unrecorded players marked attended. Existing exceptions kept.', previous)
  }

  function markCancelled(cancelled) {
    if (officersOnly()) return
    ensureSaved()
    app.data = setCancelled(app.data, weekIso, cancelled)
    showToast(cancelled ? 'Raid marked as cancelled' : 'Raid marked as held')
    if (published && hasDiscordChannel() && postedIds.length) void followPublication(postToDiscord)
  }

  /** Messages to copy by hand when the clipboard API is unavailable (e.g. not a secure context). */
  let manualCopyMessages = $state(null)

  /** Copy text for Discord, split into messages that each fit Discord's limit. */
  function copyText(text, successMessage) {
    return copyMessage(splitForDiscord(text), 0, successMessage)
  }

  /** Copy one message; while more remain, the toast offers to copy the next. */
  async function copyMessage(messages, index, successMessage) {
    try {
      await navigator.clipboard.writeText(messages[index])
    } catch {
      manualCopyMessages = messages
      return
    }
    if (messages.length === 1) return showToast(successMessage)
    const next = index + 1
    const more = next < messages.length
    showToast(
      `Copied message ${index + 1} of ${messages.length}. Paste it into Discord${more ? ', then copy the next' : ''}.`,
      more
        ? { label: `Copy message ${next + 1}`, run: () => copyMessage(messages, next, successMessage) }
        : null,
    )
  }

  function copyForDiscord() {
    copyText(rosterDiscord(app.data, plan, players), 'Roster copied. Paste it into Discord.')
  }

  $effect(() => {
    if (canManage()) void loadDiscordChannel()
  })

  const discordKey = $derived(postKey(weekIso, app.data.currentRaidId))
  const postedIds = $derived(discordChannel.posts[discordKey] ?? [])
  let posting = $state(false)
  /** Whether publishing a roster that is not in Discord yet also posts it there. */
  let postOnPublish = $state(true)

  $effect(() => {
    if (canManage() && usesServerDelivery() && hasDiscordChannel())
      void watchDelivery(weekIso, app.data.currentRaidId)
  })
  /** Only the raid on screen: a slow reload for another raid never shows here. */
  const shownDelivery = $derived(
    delivery.key === deliveryKey(weekIso, app.data.currentRaidId) ? delivery.latest : null,
  )
  // A queued or sending post is checked again until it settles (the scheduler may send it).
  const DELIVERY_POLL_MS = 15_000
  $effect(() => {
    const status = shownDelivery?.status
    if (status !== 'pending' && status !== 'sending') return
    const week = weekIso
    const raidId = app.data.currentRaidId
    const timer = setInterval(() => void refreshDelivery(week, raidId), DELIVERY_POLL_MS)
    return () => clearInterval(timer)
  })

  /**
   * Keep a roster already in Discord in step with what was just saved. Online, the save itself
   * queued the edit on the server, so this only asks the worker to send it now.
   */
  async function followPublication(browserPost) {
    if (!usesServerDelivery()) return browserPost()
    await serverAction(() => sendQueued(weekIso, app.data.currentRaidId))
  }

  async function serverAction(run) {
    posting = true
    try {
      const message = await run()
      if (message) showToast(message)
    } finally {
      posting = false
    }
  }

  /** Post the published roster to the guild's Discord channel, or update the earlier post. */
  async function postToDiscord() {
    if (officersOnly() || !published || posting) return
    if (usesServerDelivery()) return serverAction(() => queueAndSend(weekIso, app.data.currentRaidId, 'post'))
    const key = discordKey
    const confirmed = { ...published, locked: [], saved: true, cancelled: savedPlan?.cancelled ?? false }
    const mentions = discordChannel.mentionPlayers
      ? rosterMentions(app.data, confirmed)
      : { ids: [], line: '' }
    const text = [rosterDiscord(app.data, confirmed, players), mentions.line].filter(Boolean).join('\n\n')
    const previousIds = discordChannel.posts[key] ?? []
    posting = true
    try {
      const ids = await postToWebhook(discordChannel.webhookUrl, splitForDiscord(text), {
        previousIds,
        mentionIds: mentions.ids,
      })
      await rememberPost(key, ids)
      showToast(previousIds.length ? 'Discord post updated.' : 'Roster posted to Discord.')
    } catch (error) {
      showToast(error.message)
    } finally {
      posting = false
    }
  }

  async function deleteDiscordPost() {
    if (officersOnly() || posting) return
    if (usesServerDelivery())
      return serverAction(() => queueAndSend(weekIso, app.data.currentRaidId, 'delete'))
    const key = discordKey
    posting = true
    try {
      await deleteFromWebhook(discordChannel.webhookUrl, discordChannel.posts[key] ?? [])
      await rememberPost(key, [])
      showToast('Discord post deleted.')
    } catch (error) {
      showToast(error.message)
    } finally {
      posting = false
    }
  }

  async function withdrawDiscordPost() {
    if (posting) return
    posting = true
    try {
      const ids = await postToWebhook(
        discordChannel.webhookUrl,
        [
          '**ROSTER WITHDRAWN**\nThe officers are revising this raid. Check WhenToRaid for the next published roster.',
        ],
        { previousIds: discordChannel.posts[discordKey] ?? [] },
      )
      await rememberPost(discordKey, ids)
      showToast('Discord post updated: roster withdrawn.')
    } catch (error) {
      showToast(error.message)
    } finally {
      posting = false
    }
  }

  /** A link to this published roster for guild members; it opens the guild after signing in. */
  async function copyRosterLink() {
    const url = publishedRosterUrl(location, remote.guildId, weekIso, app.data.currentRaidId)
    try {
      await navigator.clipboard.writeText(url)
      showToast('Roster link copied. Guild members can open it after signing in.')
    } catch {
      manualCopyMessages = [url]
    }
  }

  function exportRoster() {
    downloadText(`whentoraid-${settings.id}-${weekIso}.txt`, rosterText(app.data, plan, players))
  }

  function exportCalendar() {
    downloadText(`whentoraid-${settings.id}-${weekIso}.ics`, rosterIcs(app.data, plan), 'text/calendar')
  }
</script>

<svelte:window onfocus={() => (responsesTick += 1)} />

<div class="planner-page">
  <PageTitle
    eyebrow={viewPublished ? 'PUBLISHED RAID' : 'RAID PLANNER'}
    title={settings.name}
    subtitle={viewPublished && !published
      ? 'Your officers have not published this raid yet.'
      : formatSessionHeading(plan, guild.timezone, viewerZone)}
  />

  <div class="planning-context"><RaidSelector /><WeekBar /></div>

  <section class="publication-bar" aria-label="Roster publication">
    <div class="publication-toolbar">
      <span class="badge" class:published={viewPublished && !!published}
        >{published
          ? viewPublished
            ? 'Published roster'
            : draftChanged
              ? 'Draft changes pending'
              : 'Draft matches published'
          : 'Not published'}</span
      >
      {#if canManage()}
        <div class="buttons">
          <div class="segmented">
            <button aria-pressed={!viewPublished} onclick={() => (showPublished = false)}>Edit draft</button>
            <button aria-pressed={viewPublished} onclick={() => (showPublished = true)}
              >View published roster</button
            >
          </div>
          {#if !viewPublished}<button class="primary" disabled={published && !draftChanged} onclick={publish}
              >{published ? 'Publish draft changes' : 'Publish roster'}</button
            >{/if}
          {#if !viewPublished && hasDiscordChannel() && !postedIds.length}<label class="checkbox-row"
              ><input type="checkbox" bind:checked={postOnPublish} />Also post to Discord</label
            >{/if}
        </div>
      {/if}
    </div>
    <details class="publication-options">
      <summary>Publication &amp; sharing options</summary>
      <p role="status" class="note">
        {!published
          ? 'No published roster for this raid yet.'
          : draftChanged
            ? 'Published roster is available. Draft changes have not been published.'
            : 'The draft matches the published roster.'}
        {viewPublished
          ? 'Viewing the published roster. Player confirmations are separate.'
          : 'Editing the draft. Changes save automatically.'}
        {#if canManage() && hasDiscordChannel() && postedIds.length}Posted to Discord; publishing draft
          changes updates the post.
        {:else if canManage() && discordChannel.loaded && !hasDiscordChannel()}Set a Discord channel in Guild
          settings to post rosters there directly.{/if}
      </p>
      {#if published && remote.guildId}
        <div class="buttons"><button onclick={copyRosterLink}>Copy roster link</button></div>
      {/if}
      {#if canManage()}
        <div class="buttons">
          {#if published}<button onclick={withdraw}>Withdraw published roster</button>{/if}
          {#if hasDiscordChannel() && published}<button disabled={posting} onclick={postToDiscord}
              >{postedIds.length ? 'Update Discord post' : 'Post to Discord'}</button
            >{/if}
          {#if hasDiscordChannel() && postedIds.length}<button onclick={deleteDiscordPost} disabled={posting}
              >Delete Discord post</button
            >{/if}
        </div>
        {#if plan.team.length}<label class="checkbox-row"
            ><input
              type="checkbox"
              checked={savedPlan?.cancelled ?? false}
              onchange={(event) => markCancelled(event.currentTarget.checked)}
            />Raid was cancelled</label
          >{/if}
      {/if}
    </details>
    {#if canManage() && usesServerDelivery() && deliveryStatus(shownDelivery)}
      <p class:warning={needsRetry(shownDelivery)} role="status">
        {deliveryStatus(shownDelivery)}
        {#if needsRetry(shownDelivery)}<button
            disabled={posting}
            onclick={() => serverAction(() => retryDelivery(weekIso, app.data.currentRaidId))}
            >Retry Discord post</button
          >{/if}
      </p>
    {/if}
    {#if savedPlan?.cancelled}<p class="warning" role="status">This raid is cancelled.</p>{/if}
    {#if canManage() && !viewPublished && published && draftChanged}
      <details class="publication-review">
        <summary>Review changes to publish</summary>
        <section aria-label="Changes to publish">
          <h3>Changes to publish</h3>
          <ul>
            {#each changes as change, i (i)}
              <li>
                {change.kind === 'time'
                  ? `Time: ${formatSessionIn(change.before, zone)} → ${formatSessionIn(change.after, zone)}`
                  : change.message}
              </li>
            {/each}
          </ul>
        </section>
      </details>
    {/if}
    {#if canManage() && !viewPublished && showIssues && issues.length}
      <section role="alert" class="publication-review">
        <h3>Resolve before publishing</h3>
        <ul>
          {#each issues as issue, i (i)}
            <li>
              <span>{issue.message}</span>
              {#if issue.memberId}
                <button onclick={() => (dialog = { kind: 'player', memberId: issue.memberId })}
                  >Review {memberById(app.data, issue.memberId)?.name ?? 'player'}</button
                >
              {:else if issue.kind === 'capacity'}
                <button onclick={() => (dialog = { kind: 'add', role: issue.role })}
                  >Review {issue.role} slots</button
                >
              {:else if issue.kind === 'empty'}
                <button onclick={() => (dialog = { kind: 'add', role: ROLES[0] })}>Add a player</button>
              {:else if issue.kind === 'cancelled'}
                <button onclick={() => markCancelled(false)}>Restore raid</button>
              {/if}
              {#if issue.kind === 'overlap'}
                <button
                  onclick={() => {
                    app.data = setCurrentRaid(setCurrentWeek(app.data, issue.week), issue.raidId)
                    showIssues = false
                  }}>Open overlapping raid</button
                >
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </section>

  {#if !viewPublished || published}
    <PlannerStats
      {checkedInCount}
      playerCount={players.length}
      rosterCount={plan.team.length}
      {totalSlots}
      {roleCounts}
      {problemCount}
    />
  {/if}

  <SectionTabs
    id="planner"
    label="Planning workspace"
    {tabs}
    value={section}
    onselect={(value) => (activeSection = value)}
  />

  {#if !viewPublished}
    <div
      id="planner-panel-schedule"
      class="planner-section"
      role="tabpanel"
      tabindex="0"
      aria-labelledby="planner-tab-schedule"
      hidden={section !== 'schedule'}
    >
      <div class="schedule-layout">
        <div>
          <div class="section-head">
            <div>
              <h2>The best windows</h2>
              <p class="subtitle">Fill the roles first. Keep backups for the roles you need most.</p>
            </div>
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
          <div class="schedule-next">
            <span>Selected: <strong>{sessionLabel}</strong></span><button
              class="primary"
              onclick={() => (activeSection = 'roster')}>Review roster →</button
            >
          </div>
          <details class="disclosure availability-map">
            <summary><span>Explore guild availability</span><small>Compare every start time</small></summary>
            <div class="disclosure-content">
              <h3>Guild availability</h3>
              <p class="small-text">Each cell shows a full session starting at that time.</p>
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
          </details>
          <details class="disclosure">
            <summary>This week’s other raids</summary><WeeklyOverview publishedOnly={viewPublished} />
          </details>
        </div>
        <div class="planning-side">
          <CheckinPanel oncopy={copyText} />
          <ReadinessPanel
            {sessionLabel}
            {roleCounts}
            {readyCounts}
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
    </div>
  {/if}

  <div
    id="planner-panel-roster"
    class="planner-section"
    role="tabpanel"
    tabindex="0"
    aria-labelledby="planner-tab-roster"
    hidden={section !== 'roster'}
  >
    {#if !viewPublished || published}
      <div class="section-head roster-header">
        <div>
          <h2>Your raid roster</h2>
          <p class="subtitle">
            {viewPublished
              ? 'Published assignment · attendance is confirmed separately'
              : 'Draft · changes save automatically'}
          </p>
        </div>
        <details class="export-options">
          <summary>Share &amp; export</summary>
          <div class="buttons">
            <button onclick={copyForDiscord}>Copy for Discord</button><button onclick={exportCalendar}
              >Add to calendar (.ics)</button
            ><button onclick={exportRoster}>Download .txt ↓</button>
          </div>
        </details>
      </div>
      {#if !viewPublished}<div class="roster-tools buttons">
          <button onclick={rebuild}>↻ Rebuild roster</button><button onclick={copyLastWeek}
            >Copy last week’s roster</button
          >{#if undoChange && undoChange.week === weekIso && undoChange.raidId === app.data.currentRaidId}<button
              onclick={undoRoster}>Undo roster change</button
            >{/if}
        </div>{/if}
      {#if ruleIssues.length}
        <ul class="rule-issues warning" role="status" aria-label="Composition rules">
          {#each ruleIssues as issue, i (i)}<li>{issue.message}</li>{/each}
        </ul>
      {/if}
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

      {#if plan.team.length && !viewPublished && tracksAttendance(app.data)}
        <AttendancePanel
          team={plan.team}
          attendance={savedPlan?.attendance ?? {}}
          cancelled={savedPlan?.cancelled ?? false}
          onmark={markAttendance}
          onall={markEveryone}
        />
      {/if}
    {:else}<div class="panel empty-state">
        <h2>No published roster yet</h2>
        <p>Your officers are still planning this raid. Your assignment will appear once they publish.</p>
      </div>{/if}
  </div>

  {#if canManage()}
    <div
      id="planner-panel-responses"
      class="planner-section"
      role="tabpanel"
      tabindex="0"
      aria-labelledby="planner-tab-responses"
      hidden={section !== 'responses'}
    >
      {#if usesServerDelivery()}
        <SignupsPanel week={weekIso} raidId={app.data.currentRaidId} canManage={canManage()} />
      {/if}
      {#if published && !savedPlan?.cancelled}
        {#if responses.key === responsesKey}
          <RaidResponsesPanel
            team={published.team}
            byMember={responses.byMember}
            error={responses.error}
            checkedAt={responses.checkedAt}
            checking={checkingResponses}
            {zone}
            canReplace={inDraft}
            onreplace={replaceMember}
            onrefresh={() => (responsesTick += 1)}
          />
        {:else}<p role="status">Loading player responses…</p>{/if}
      {:else}<div class="panel empty-state">
          <h2>{savedPlan?.cancelled ? 'This raid is cancelled' : 'Publish before collecting responses'}</h2>
          <p>
            {savedPlan?.cancelled
              ? 'Restore the raid to review player responses.'
              : 'When the roster is published, players can confirm their place or tell you they can’t make it.'}
          </p>
          {#if !savedPlan?.cancelled}<button
              onclick={() => {
                showPublished = false
                activeSection = 'roster'
              }}>Review the draft roster</button
            >{/if}
        </div>{/if}
    </div>
  {/if}

  {#if app.data.demoYear}<p class="demo-note">
      Demo guild · Sample availability and raid plans for {app.data.demoYear}.
    </p>{/if}
</div>

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

<Modal
  open={manualCopyMessages !== null}
  onclose={() => (manualCopyMessages = null)}
  label="Copy for Discord"
>
  <h2>Copy for Discord</h2>
  <p>
    Your browser blocked clipboard access. Select the text below and copy it{manualCopyMessages?.length > 1
      ? ', one message at a time'
      : ''}.
  </p>
  {#each manualCopyMessages ?? [] as message, i (i)}
    {#if manualCopyMessages.length > 1}<h3>Message {i + 1} of {manualCopyMessages.length}</h3>{/if}
    <textarea
      class="copy-box"
      readonly
      rows="14"
      aria-label="Message {i + 1}"
      value={message}
      onfocus={(e) => e.currentTarget.select()}></textarea>
  {/each}
</Modal>

<Modal
  open={replacementTarget !== null}
  onclose={() => (replacementTarget = null)}
  label={`Replace ${memberById(app.data, replacementTarget)?.name ?? 'player'}`}
>
  <h2>Replace {memberById(app.data, replacementTarget)?.name ?? 'player'}</h2>
  <p>Available players offering the same role, excluding other published commitments.</p>
  <div class="modal-list">
    {#each replacements as option (option.character.id)}
      <button onclick={() => confirmReplacement(option.player.id, option.character.id)}>
        <strong>{characterById(app.data, option.character.id)?.name}</strong>
        <small>{memberById(app.data, option.player.id)?.name} · {option.character.role}</small>
      </button>
    {:else}
      <p class="note">
        No eligible replacement for this role at this time. Review availability or choose another session.
      </p>
    {/each}
  </div>
</Modal>

<style>
  .publication-review {
    margin: 1rem 0;
    padding: 0.75rem 1rem;
    border-left: 2px solid var(--gold);
    background: #ffffff05;
  }
  .publication-review li {
    margin: 0.5rem 0;
  }
  .publication-review li button {
    margin: 0.25rem;
  }
  .rule-issues {
    margin: 0.75rem 0;
    padding-left: 1.25rem;
  }
</style>
