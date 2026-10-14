<script>
  import PageTitle from '../components/PageTitle.svelte'
  import OnboardingChecklist from '../components/OnboardingChecklist.svelte'
  import InlineSaveStatus from '../components/InlineSaveStatus.svelte'
  import RaidResponse from '../components/RaidResponse.svelte'
  import CalendarSubscription from '../components/CalendarSubscription.svelte'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { app } from '../lib/app.svelte.js'
  import { viewerZone } from '../lib/display.svelte.js'
  import { getCheckin, memberById } from '../lib/model.js'
  import { personalRaids, availabilitySource, exactSessionLabel } from '../lib/personal-raids.js'
  import { mondayOf, todayIso } from '../lib/time.js'

  let now = $state(Date.now())
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000)
    return () => clearInterval(timer)
  })
  const memberId = $derived(app.data.currentMemberId)
  const member = $derived(memberById(app.data, memberId))
  const thisWeek = $derived(mondayOf(todayIso(app.data.guild.timezone, now)))
  const upcoming = $derived(personalRaids(app.data, memberId, now))
  const assigned = $derived(upcoming.filter((item) => item.assignment))
  const next = $derived(assigned[0])
  const checkin = $derived(getCheckin(app.data, thisWeek, memberId))
  const later = $derived(upcoming.filter((item) => item !== next))
  const datePart = (instant, options) =>
    new Intl.DateTimeFormat('en-US', { timeZone: viewerZone, ...options }).format(instant)

  function openRaid(item) {
    app.data = { ...app.data, currentWeek: item.weekIso, currentRaidId: item.raidId }
    app.plannerIntent = 'published'
    app.view = 'planner'
  }

  function checkIn() {
    app.data = { ...app.data, currentWeek: thisWeek }
    app.view = 'availability'
  }
</script>

<PageTitle
  eyebrow={member ? `YOUR RAID WEEK · ${member.name}` : 'YOUR RAID WEEK'}
  title="My next raid"
  subtitle={`Your assignments and availability, in ${viewerZone.replaceAll('_', ' ')}.`}
/>

<div class="home-priorities">
  <section class="panel next-raid" aria-label="Next raid assignment">
    {#if next}
      <div class="next-raid-heading">
        <div class="raid-date" aria-hidden="true">
          <span>{datePart(next.session.start, { weekday: 'short' })}</span><strong
            >{datePart(next.session.start, { day: 'numeric' })}</strong
          ><span>{datePart(next.session.start, { month: 'short' })}</span>
        </div>
        <div>
          <span class="badge published">{next.session.start <= now ? 'IN PROGRESS' : 'YOU’RE ROSTERED'}</span>
          <h2>{next.raid.name}</h2>
        </div>
      </div>
      <p class="raid-time">{exactSessionLabel(next.session, viewerZone)}</p>
      <div class="assignment">
        <span class="eyebrow">YOUR CHARACTER</span>
        <p>
          <strong>{next.character?.name ?? 'Your assigned character'}</strong>
          <span class="badge">{next.assignment.role}</span>
        </p>
        {#if next.character}<small
            >{next.character.spec} {next.character.class} · {next.character.realm}</small
          >{/if}
      </div>
      <RaidResponse item={next} {memberId} />
      <button class="text-button" onclick={() => openRaid(next)}
        >View published roster <span aria-hidden="true">→</span></button
      >
    {:else}
      <span class="eyebrow">UP NEXT</span>
      <h2>No upcoming assignment yet</h2>
      <p>When an officer publishes a roster with you on it, your raid and character will appear here.</p>
      <p class="empty-guidance">
        {checkin.checkedIn
          ? 'Your availability is in. You’re ready for the next roster.'
          : 'Start with your availability so your officers can plan around you.'}
      </p>
    {/if}
  </section>

  <section class="panel home-checkin" aria-label="This week’s check-in">
    <span class="eyebrow">YOUR PART IS SIMPLE</span>
    <h2>This week’s availability</h2>
    <span class="badge" class:success={checkin.checkedIn}
      >{availabilitySource(app.data, thisWeek, memberId)}</span
    >
    <p>
      {!checkin.checkedIn
        ? 'Your officers are waiting for your times.'
        : checkin.ranges.length
          ? 'Your times are ready for planning. Review them if anything has changed.'
          : 'You have let officers know you can’t make it this week.'}
    </p>
    <button class:primary={!checkin.checkedIn} onclick={checkIn}>Update my availability</button>
    <InlineSaveStatus />
  </section>
</div>

<OnboardingChecklist {memberId} weekIso={thisWeek} />

{#if later.length}
  <section class="upcoming" aria-label="Upcoming published raids">
    <h2>Upcoming published raids</h2>
    <ul>
      {#each later as item (`${item.weekIso}:${item.raidId}`)}
        <li>
          <div class="upcoming-date">
            <strong>{datePart(item.session.start, { month: 'short', day: 'numeric' })}</strong><small
              >{datePart(item.session.start, { weekday: 'long' })}</small
            >
          </div>
          <div>
            <h3>{item.raid.name}</h3>
            <p>{exactSessionLabel(item.session, viewerZone)}</p>
            <p>
              {item.assignment
                ? `${item.character?.name ?? 'Assigned character'} · ${item.assignment.role}`
                : 'You are not on this roster'}
            </p>
          </div>
          <button aria-label={`View roster for ${item.raid.name}`} onclick={() => openRaid(item)}
            >View roster</button
          >
          {#if item.assignment}<RaidResponse {item} {memberId} />{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if remote.guildId && remote.memberId === memberId}
  <div class="spaced-top"><CalendarSubscription /></div>
{/if}

<style>
  .home-priorities {
    display: grid;
    grid-template-columns: minmax(0, 1.7fr) minmax(280px, 1fr);
    gap: 24px;
    align-items: start;
  }
  .next-raid {
    border-top: 2px solid var(--gold);
    padding: 28px;
  }
  .next-raid h2 {
    font-size: 26px;
    margin-top: 12px;
  }
  .next-raid-heading {
    display: flex;
    gap: 22px;
    align-items: center;
  }
  .raid-date {
    flex: 0 0 72px;
    display: grid;
    text-align: center;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--gold);
  }
  .raid-date span {
    font-size: 12px;
    text-transform: uppercase;
  }
  .raid-date strong {
    font-size: 32px;
    line-height: 1.2;
  }
  .assignment {
    padding: 18px 0;
    border-block: 1px solid var(--line);
  }
  .assignment p {
    margin: 8px 0 4px;
    color: var(--text);
  }
  .assignment strong {
    margin-right: 10px;
  }
  .home-checkin h2 {
    margin: 12px 0 16px;
  }
  .empty-guidance {
    border-top: 1px solid var(--line);
    padding-top: 20px;
  }
  .raid-time {
    font-size: 15px;
    color: var(--text);
  }
  .upcoming {
    margin-top: 1.5rem;
  }
  ul {
    display: grid;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    padding: 18px 0;
    border-bottom: 1px solid var(--line);
  }
  li > div {
    flex: 1 1 18rem;
  }
  h3 {
    margin-top: 0;
  }
  li .upcoming-date {
    flex: 0 0 95px;
  }
  li p {
    margin: 4px 0;
    font-size: 13px;
  }
  @media (max-width: 1000px) {
    .home-priorities {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 600px) {
    .next-raid {
      padding: 20px;
    }
    .next-raid h2 {
      font-size: 22px;
    }
    .next-raid-heading {
      gap: 16px;
    }
  }
</style>
