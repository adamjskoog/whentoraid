<script>
  /** The planner's headline numbers: check-ins, roster size, and schedule conflicts. */
  let { checkedInCount, playerCount, rosterCount, totalSlots, roleCounts, problemCount } = $props()
</script>

<div class="stats">
  <div class="stat">
    <span class="stat-label">WEEKLY CHECK-INS</span>
    <strong>{checkedInCount} <span>/ {playerCount}</span></strong>
    <small>Players who checked in this week</small>
  </div>
  <div class="stat">
    <span class="stat-label">CURRENT ROSTER</span>
    <strong>{rosterCount} <span>/ {totalSlots}</span></strong>
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
