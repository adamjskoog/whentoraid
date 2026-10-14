<script>
  import { app } from '../lib/app.svelte.js'
  import { requestLeave } from '../lib/leave-guard.js'
  import { setCurrentMember } from '../lib/members.js'
  import { memberById } from '../lib/model.js'
  import { canManage, remote } from '../lib/remote/sync.svelte.js'
  import Icon from './Icon.svelte'

  const NAV_ITEMS = [
    { view: 'home', icon: 'home', label: 'My raids' },
    { view: 'availability', icon: 'calendar', label: 'My availability' },
    { view: 'characters', icon: 'character', label: 'My characters' },
    { view: 'planner', icon: 'planner', label: 'Raid planner' },
    { view: 'members', icon: 'members', label: 'Guild members' },
    { view: 'settings', icon: 'settings', label: 'Guild settings' },
  ]
  let moreOpen = $state(false)
  let moreButton

  function navigate(view) {
    requestLeave(() => {
      app.view = view
      moreOpen = false
    })
  }

  function closeMenu(event) {
    if (event.key === 'Escape' && moreOpen) {
      moreOpen = false
      moreButton?.focus()
    }
  }

  const me = $derived(memberById(app.data, app.data.currentMemberId))
  const initials = $derived((me?.name ?? '?').slice(0, 2).toUpperCase())

  function goHome(event) {
    event.preventDefault()
    navigate('home')
  }

  function switchMember(event) {
    app.data = setCurrentMember(app.data, event.currentTarget.value)
  }
</script>

<svelte:window onkeydown={closeMenu} />

<aside class="sidebar" class:more-open={moreOpen}>
  <a class="brand" href="#/home" onclick={goHome}>
    <span class="crest">W</span>
    <span>WHEN<span class="gold">TO</span>RAID<small>THE GUILD WAR ROOM</small></span>
  </a>
  <div class="guild">
    <span class="guild-icon">✦</span>
    <div>{app.data.guild.name}<small>WoW: Forever · {app.data.members.length} players</small></div>
  </div>
  <nav class="personal-nav" aria-label="Your raid week">
    <p class="nav-label">YOUR RAID WEEK</p>
    {#each NAV_ITEMS.slice(0, 3) as item (item.view)}
      <button
        class:active={app.view === item.view}
        aria-current={app.view === item.view ? 'page' : undefined}
        onclick={() => navigate(item.view)}
      >
        <Icon name={item.icon} /> <span>{item.label}</span>
      </button>
    {/each}
    <button
      class="mobile-more"
      class:active={moreOpen || ['planner', 'members', 'settings'].includes(app.view)}
      aria-expanded={moreOpen}
      aria-controls="guild-menu"
      onclick={() => (moreOpen = !moreOpen)}
      bind:this={moreButton}><Icon name="more" /><span>More</span></button
    >
  </nav>
  <div class="guild-menu" id="guild-menu">
    <p class="mobile-guild-name">{app.data.guild.name}</p>
    <nav aria-label="Guild tools">
      <p class="nav-label">GUILD TOOLS</p>
      {#each NAV_ITEMS.slice(3) as item (item.view)}
        <button
          class:active={app.view === item.view}
          aria-current={app.view === item.view ? 'page' : undefined}
          onclick={() => navigate(item.view)}><Icon name={item.icon} /><span>{item.label}</span></button
        >
      {/each}
    </nav>
    <div class="aside-bottom">
      <span class="live-dot" class:warn={remote.status === 'error'}></span>
      {remote.guildId
        ? remote.status === 'error'
          ? 'Online · not saved'
          : 'Online · shared with your guild'
        : 'Saved in this browser'}
      <div class="user">
        <span class="avatar" aria-hidden="true">{initials}</span>
        {#if canManage()}
          <label class="field acting-as">
            {remote.guildId ? 'Editing as' : 'Acting as'}
            <select value={app.data.currentMemberId} onchange={switchMember}>
              {#each app.data.members as member (member.id)}
                <option value={member.id}>{member.name}</option>
              {/each}
            </select>
          </label>
        {:else}
          <div class="acting-as">{me?.name ?? 'Signed in'}<small>Player</small></div>
        {/if}
      </div>
      <nav class="legal-links" aria-label="Legal">
        <a href="./privacy.html">Privacy</a> · <a href="./terms.html">Terms</a>
      </nav>
    </div>
  </div>
</aside>
