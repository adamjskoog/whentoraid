<script>
  import { DURATION_OPTIONS, MAX_RAID_SIZE, ROLES } from '../lib/constants.js'
  let { raid } = $props()
  let targets = $state([...raid.targets])
  let size = $state(raid.size)
  const total = $derived(targets.reduce((sum, n) => sum + (Number(n) || 0), 0))
</script>

<div class="settings-grid">
  <label class="field">Raid name<input name="raidName" required maxlength="60" value={raid.name} /></label>
  <label class="field"
    >Raid size<input
      name="raidSize"
      type="number"
      min="1"
      max={MAX_RAID_SIZE}
      required
      bind:value={size}
    /></label
  >
  {#each ROLES as role, i (role)}
    <label class="field"
      >{role} slots<input
        name="role{i}"
        type="number"
        min="0"
        max={MAX_RAID_SIZE}
        required
        bind:value={targets[i]}
      /></label
    >
  {/each}
  <label class="field"
    >Raid duration
    <select name="duration">
      {#each DURATION_OPTIONS as slots (slots)}
        <option value={slots} selected={raid.durationSlots === slots}
          >{slots / 2} {slots === 2 ? 'hour' : 'hours'}</option
        >
      {/each}
    </select>
  </label>
</div>
<p role="status" class="note" class:warning={total !== size}>
  {total}/{size || 0} slots assigned{total === size
    ? ' · Composition complete'
    : total < size
      ? ` · ${size - total} remaining`
      : ` · ${total - size} too many`}
</p>
