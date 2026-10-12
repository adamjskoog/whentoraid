/**
 * Posting to a Discord channel through its webhook, straight from the browser (Discord allows
 * cross-origin webhook calls). A roster can need several messages; posting again edits the
 * messages posted before, so the channel keeps one copy of each raid's roster.
 */

/** Same rule as valid_webhook_url in supabase/migrations. */
const WEBHOOK_URL =
  /^https:\/\/(ptb\.|canary\.)?discord(app)?\.com\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]{20,100}$/

export function isWebhookUrl(url) {
  return WEBHOOK_URL.test(String(url ?? '').trim())
}

/** Discord accepts at most this many user mentions per message. */
const MAX_MENTIONS = 100
/** Longest wait for a rate limit before giving up. */
const MAX_RETRY_MS = 5000

const GONE = 'Discord no longer accepts this channel’s webhook. Paste a new webhook URL in Guild settings.'

class DiscordError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

/** One request, retried once after a short rate limit. */
async function send(fetchFn, url, method, body) {
  for (let attempt = 0; ; attempt += 1) {
    let response
    try {
      response = await fetchFn(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch {
      throw new DiscordError('Could not reach Discord. Check your connection and try again.', 0)
    }
    if (response.status === 429 && attempt === 0) {
      const { retry_after: seconds = 1 } = await response.json().catch(() => ({}))
      if (seconds * 1000 <= MAX_RETRY_MS) {
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
        continue
      }
    }
    if (response.status === 429) throw new DiscordError('Discord is busy. Try again in a minute.', 429)
    if (!response.ok) {
      throw new DiscordError(`Discord refused the message (error ${response.status}).`, response.status)
    }
    return response.status === 204 ? null : response.json()
  }
}

/** Delete messages, skipping ones already deleted in Discord. */
async function deleteMessages(fetchFn, base, messageIds) {
  for (const id of messageIds) {
    await send(fetchFn, `${base}/messages/${id}`, 'DELETE').catch((error) => {
      if (error.status !== 404) throw error
    })
  }
}

/**
 * Post `messages` to the webhook, editing `previousIds` (messages of an earlier post) in place
 * and deleting any left over. Pings go only to `mentionIds`, never @everyone, @here, or roles,
 * and only in newly posted messages: Discord notifies nobody about edits.
 * @returns {Promise<string[]>} the ids of the messages that now hold the post
 */
export async function postToWebhook(
  webhookUrl,
  messages,
  { previousIds = [], mentionIds = [], fetchFn = fetch } = {},
) {
  const base = webhookUrl.trim()
  const allowed = (users) => ({ parse: [], users: users.slice(0, MAX_MENTIONS) })
  const create = async (content) => {
    try {
      const message = await send(fetchFn, `${base}?wait=true`, 'POST', {
        content,
        allowed_mentions: allowed(mentionIds),
      })
      return message.id
    } catch (error) {
      if (error.status === 401 || error.status === 404) throw new DiscordError(GONE, error.status)
      throw error
    }
  }

  const ids = []
  for (const [i, content] of messages.entries()) {
    const previous = previousIds[i]
    if (!previous) {
      ids.push(await create(content))
      continue
    }
    try {
      await send(fetchFn, `${base}/messages/${previous}`, 'PATCH', { content, allowed_mentions: allowed([]) })
      ids.push(previous)
    } catch (error) {
      // Someone deleted the old message in Discord: post this part again.
      if (error.status !== 404) throw error
      ids.push(await create(content))
    }
  }
  await deleteMessages(fetchFn, base, previousIds.slice(messages.length))
  return ids
}

/** Delete a post's messages. */
export async function deleteFromWebhook(webhookUrl, messageIds, { fetchFn = fetch } = {}) {
  await deleteMessages(fetchFn, webhookUrl.trim(), messageIds)
}
