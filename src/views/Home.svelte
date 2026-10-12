<script>
  import PageTitle from '../components/PageTitle.svelte'
  import OnboardingChecklist from '../components/OnboardingChecklist.svelte'
  import InlineSaveStatus from '../components/InlineSaveStatus.svelte'
  import RaidResponse from '../components/RaidResponse.svelte'
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

  function openRaid(item) {
    app.data = { ...app.data, currentWeek: item.weekIso, currentRaidId: item.raidId }
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
  subtitle={`Your published assignments. All times below are in ${viewerZone}.`}
/>

<section class="panel next-raid" aria-label="Next raid assignment">
  {#if next}
    <span class="badge">{next.session.start <= now ? 'IN PROGRESS' : 'YOU’RE ROSTERED'}</span>
    <h2>{next.raid.name}</h2>
    <p class="raid-time">{exactSessionLabel(next.session, viewerZone)}</p>
    <p>
      Bring <strong>{next.character?.name ?? 'your assigned character'}</strong> as
      <strong>{next.assignment.role}</strong>.
    </p>
    {#if next.character}<p>{next.character.spec} {next.character.class} · {next.character.realm}</p>{/if}
    <button onclick={() => openRaid(next)}>View published roster</button>
    <RaidResponse item={next} {memberId} />
  {:else}
    <h2>No upcoming assignment yet</h2>
    <p>When an officer publishes a roster with you on it, your raid and character will appear here.</p>
    <button onclick={checkIn}>Review my availability</button>
  {/if}
</section>

<OnboardingChecklist {memberId} weekIso={thisWeek} />

<section class="panel" aria-label="This week’s check-in">
  <h2>This week’s availability</h2>
  <span class="badge">{availabilitySource(app.data, thisWeek, memberId)}</span>
  <p>
    {!checkin.checkedIn
      ? 'Your officers are waiting for your times.'
      : checkin.ranges.length
        ? 'Your times are ready for planning. Review them if anything has changed.'
        : 'You have let officers know you can’t make it this week.'}
  </p>
  <button onclick={checkIn}>Update my availability</button>
  <InlineSaveStatus />
</section>

{#if upcoming.length}
  <section class="upcoming" aria-label="Upcoming published raids">
    <h2>Upcoming published raids</h2>
    <ul>
      {#each upcoming as item (`${item.weekIso}:${item.raidId}`)}
        <li class="panel">
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
          {#if item.assignment && item !== next}<RaidResponse {item} {memberId} />{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .next-raid {
    border-top: 3px solid var(--gold, #cca55c);
  }
  .raid-time {
    font-size: 1.1rem;
  }
  .upcoming {
    margin-top: 1.5rem;
  }
  ul {
    display: grid;
    gap: 0.75rem;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
  }
  li > div {
    flex: 1 1 18rem;
  }
  h3 {
    margin-top: 0;
  }
</style>
