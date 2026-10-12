import { loadDiscordChannel } from './discord-channel.svelte.js'
import {
  dispatchDiscordDeliveries,
  listDiscordDeliveries,
  queueDiscordDelivery,
  retryDiscordDelivery,
} from './raid-services.js'
import { supabase } from './remote/client.js'
import { flushOnlineChanges, remote } from './remote/sync.svelte.js'

/**
 * Online guilds send roster posts from the server: saving a publication queues an edit of a roster
 * already in Discord, and the raid-dispatch worker sends it. A failed send is kept for a retry
 * instead of being lost with the browser tab. Browser guilds still post straight from the page.
 */

export const usesServerDelivery = () => Boolean(remote.guildId && supabase)

/** The latest delivery for the raid on screen: status, attempts and the last error. */
export const delivery = $state({ key: null, latest: null, error: '' })

export const deliveryKey = (week, raidId) => JSON.stringify([remote.guildId, week, raidId])
let latestRequest = 0

/** Show the delivery for the raid now on screen. */
export function watchDelivery(week, raidId) {
  const key = deliveryKey(week, raidId)
  if (delivery.key !== key) Object.assign(delivery, { key, latest: null, error: '' })
  return refreshDelivery(week, raidId)
}

/** Reload the status, unless the officer has moved to another raid (or a newer reload started). */
export async function refreshDelivery(week, raidId) {
  const key = deliveryKey(week, raidId)
  if (delivery.key !== key) return
  const request = ++latestRequest
  try {
    const rows = await listDiscordDeliveries(supabase, remote.guildId, week, raidId)
    if (delivery.key === key && request === latestRequest)
      Object.assign(delivery, { latest: rows?.[0] ?? null, error: '' })
  } catch (error) {
    if (delivery.key === key && request === latestRequest) delivery.error = error.message
  }
}

/**
 * Ask the worker to send what is queued, then show the outcome. Returns a message for a toast.
 * The plan must be saved first: the server only sends what has been committed.
 */
export async function sendQueued(week, raidId) {
  let message
  try {
    await flushOnlineChanges()
    const results = await dispatchDiscordDeliveries(supabase, remote.guildId)
    const problem = results.find((result) => result.status === 'uncertain' || result.status === 'retrying')
    message = problem ? problem.error : results.length ? 'Discord post updated.' : null
  } catch (error) {
    message = error.message
  }
  await Promise.all([loadDiscordChannel({ force: true }), refreshDelivery(week, raidId)])
  return message
}

/** Post (or delete) the published roster for one raid. */
export async function queueAndSend(week, raidId, action) {
  try {
    await flushOnlineChanges()
    await queueDiscordDelivery(supabase, remote.guildId, week, raidId, action)
  } catch (error) {
    return error.message
  }
  return (await sendQueued(week, raidId)) ?? 'Queued for Discord.'
}

export async function retryDelivery(week, raidId) {
  if (!delivery.latest) return null
  try {
    await retryDiscordDelivery(supabase, remote.guildId, delivery.latest.id)
  } catch (error) {
    return error.message
  }
  return (await sendQueued(week, raidId)) ?? 'Queued for Discord.'
}

/** Words for the status line under the roster buttons. */
export function deliveryStatus(latest) {
  if (!latest) return ''
  switch (latest.status) {
    case 'pending':
      return latest.last_error
        ? `Discord post waiting to retry: ${latest.last_error}`
        : 'Discord post queued; it will be sent shortly.'
    case 'sending':
      return 'Sending to Discord…'
    case 'failed':
      return `Discord post failed: ${latest.last_error ?? 'unknown error'}`
    case 'uncertain':
      return `${latest.last_error ?? 'Delivery may not have finished.'} Check the channel, then retry if the post is missing.`
    default:
      return ''
  }
}

export const needsRetry = (latest) => latest?.status === 'failed' || latest?.status === 'uncertain'
