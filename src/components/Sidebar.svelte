<script>
  import { app } from '../lib/app.svelte.js'
  import { setCurrentMember } from '../lib/members.js'
  import { memberById } from '../lib/model.js'
  import { canManage, remote } from '../lib/remote/sync.svelte.js'

  const NAV_ITEMS = [
    { view: 'planner', icon: '⚔', label: 'Raid planner' },
    { view: 'availability', icon: '▦', label: 'My availability' },
    { view: 'characters', icon: '♙', label: 'My characters' },
    { view: 'members', icon: '☰', label: 'Guild members' },
    { view: 'settings', icon: '⚙', label: 'Guild settings' },
  ]

  const me = $derived(memberById(app.data, app.data.currentMemberId))
  const initials = $derived((me?.name ?? '?').slice(0, 2).toUpperCase())

  function goHome(event) {
    event.preventDefault()
    app.view = 'planner'
  }

  function switchMember(event) {
    app.data = setCurrentMember(app.data, event.currentTarget.value)
  }
</script>

<aside>
  <a class="brand" href="#/planner" onclick={goHome}>
    <span class="crest">W</span>
    <span>WHEN<span class="gold">TO</span>RAID<small>THE GUILD WAR ROOM</small></span>
  </a>
  <div class="guild">
    <span class="guild-icon">✦</span>
    <div>{app.data.guild.name}<small>WoW: Forever · {app.data.members.length} players</small></div>
  </div>
  <p class="eyebrow">YOUR GUILD</p>
  <nav>
    {#each NAV_ITEMS as item (item.view)}
      <button class:active={app.view === item.view} onclick={() => (app.view = item.view)}>
        {item.icon} <span>{item.label}</span>
      </button>
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
  </div>
</aside>
