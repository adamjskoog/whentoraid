<script>
  import { MAX_RESPONSE_NOTE } from '../lib/raid-services.js'
  import {
    canRespondAs,
    loadRaidResponses,
    respondToRaid,
    responseKey,
  } from '../lib/raid-responses.svelte.js'

  /**
   * A rostered player confirms their place or reports a problem. Responses stay open after the
   * check-in deadline, since that is when late changes matter most.
   * `item` is one of `personalRaids()`, with the player's assignment.
   */
  let { item, memberId } = $props()

  const key = $derived(responseKey(item.weekIso, item.raidId, item.plan))
  const canRespond = $derived(canRespondAs(memberId))
  let response = $state(null)
  let loadedKey = $state(null)
  let reporting = $state(false)
  let note = $state('')
  let saving = $state(false)
  let error = $state('')
  const current = $derived(loadedKey === key ? response : null)

  $effect(() => {
    const wanted = key
    loadRaidResponses(item.weekIso, item.raidId, item.plan)
      .then((byMember) => {
        if (wanted !== key) return
        response = byMember[memberId] ?? null
        loadedKey = wanted
        error = ''
      })
      .catch((e) => {
        if (wanted === key) error = e.message
      })
  })

  async function respond(status) {
    // The roster this answer is for; if it is republished meanwhile, the answer is not shown as current.
    const answered = key
    saving = true
    error = ''
    const text = status === 'unavailable' ? note.trim() : ''
    try {
      await respondToRaid({
        week: item.weekIso,
        raidId: item.raidId,
        published: item.plan,
        memberId,
        status,
        note: text,
      })
      if (answered !== key) return
      response = { member_id: memberId, status, note: text }
      loadedKey = answered
      reporting = false
      note = ''
    } catch (e) {
      error = e.message
    } finally {
      saving = false
    }
  }
</script>

<div class="raid-response">
  {#if current?.status === 'confirmed'}
    <p class="status confirmed">
      {canRespond ? 'You' : 'This player'} confirmed {canRespond ? 'you’ll' : 'they’ll'} be there.
    </p>
  {:else if current?.status === 'unavailable'}
    <p class="status warning">
      {canRespond ? 'You' : 'This player'} told the officers {canRespond ? 'you' : 'they'} can’t make it{current.note
        ? `: “${current.note}”`
        : '.'}
    </p>
  {/if}

  {#if !canRespond}
    <p class="note">Only this player can confirm or report a problem, after signing in.</p>
  {:else if reporting}
    <label class="field">
      What’s changed? (optional)
      <textarea
        bind:value={note}
        maxlength={MAX_RESPONSE_NOTE}
        rows="2"
        placeholder="e.g. Working late, can join at 9"></textarea>
    </label>
    <div class="buttons">
      <button disabled={saving} onclick={() => respond('unavailable')}>Tell the officers</button>
      <button disabled={saving} onclick={() => (reporting = false)}>Cancel</button>
    </div>
  {:else}
    <div class="buttons">
      {#if current?.status !== 'confirmed'}
        <button class="primary" disabled={saving} onclick={() => respond('confirmed')}
          >{saving ? 'Saving…' : 'I’ll be there'}</button
        >
      {/if}
      {#if current?.status !== 'unavailable'}
        <button disabled={saving} onclick={() => (reporting = true)}>I can’t make it</button>
      {/if}
    </div>
  {/if}
  {#if error}<p role="alert" class="warning">{error}</p>{/if}
</div>

<style>
  .raid-response {
    margin-top: 1rem;
  }
  .status {
    margin: 0 0 0.5rem;
  }
  .confirmed {
    color: var(--green, #92c892);
  }
  textarea {
    width: 100%;
  }
</style>
