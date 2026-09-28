<script>
  import { app } from '../lib/app.svelte.js'
  import { memberById } from '../lib/model.js'

  const NAV_ITEMS = [
    { view: 'planner', icon: '⚔', label: 'Raid planner' },
    { view: 'availability', icon: '▦', label: 'My availability' },
    { view: 'characters', icon: '♙', label: 'My characters' },
    { view: 'settings', icon: '⚙', label: 'Guild settings' },
  ]

  const me = $derived(memberById(app.data, app.data.currentMemberId))
  const initials = $derived((me?.name ?? '?').slice(0, 2).toUpperCase())

  function goHome(event) {
    event.preventDefault()
    app.view = 'planner'
  }
</script>

<aside>
  <a class="brand" href="/" onclick={goHome}>
    <span class="crest">W</span>
    <span>WHEN<span class="gold">TO</span>RAID<small>THE GUILD WAR ROOM</small></span>
  </a>
  <div class="guild">
    <span class="guild-icon">✦</span>
    <div>{app.data.guild.name}<small>WoW: Forever · Sample guild</small></div>
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
    <span class="live-dot"></span> Local prototype<small>Sample data · Saved on this browser</small>
    <div class="user">
      <span class="avatar">{initials}</span>
      <div>{me?.name}<small>Officer preview</small></div>
    </div>
  </div>
</aside>
