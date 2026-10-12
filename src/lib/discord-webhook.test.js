import { describe, expect, test, vi } from 'vitest'
import { deleteFromWebhook, isWebhookUrl, postToWebhook } from './discord-webhook.js'

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-0123456789'

/** A fake Discord: answers each request from `replies` in order, and records the calls. */
function fakeDiscord(...replies) {
  let next = 1300000000000000000n
  return vi.fn(async (_url, init) => {
    const reply = replies.shift() ?? {}
    const status = reply.status ?? (init.method === 'DELETE' ? 204 : 200)
    const body = reply.body ?? { id: String((next += 1n)) }
    return { status, ok: status < 300, json: async () => body }
  })
}

const calls = (fetchFn) =>
  fetchFn.mock.calls.map(([url, init]) => ({
    method: init.method,
    path: url.slice(HOOK.length),
    body: init.body ? JSON.parse(init.body) : null,
  }))

describe('isWebhookUrl', () => {
  test('accepts Discord channel webhooks only', () => {
    expect(isWebhookUrl(HOOK)).toBe(true)
    expect(isWebhookUrl(` ${HOOK} `)).toBe(true)
    expect(isWebhookUrl(HOOK.replace('discord.com', 'ptb.discord.com'))).toBe(true)
    expect(isWebhookUrl(HOOK.replace('https:', 'http:'))).toBe(false)
    expect(isWebhookUrl(HOOK.replace('discord.com', 'discord.com.evil.example'))).toBe(false)
    expect(isWebhookUrl('https://discord.com/channels/1/2')).toBe(false)
    expect(isWebhookUrl(undefined)).toBe(false)
  })
})

describe('postToWebhook', () => {
  test('a first post creates each message and pings only the given players', async () => {
    const fetchFn = fakeDiscord()
    const ids = await postToWebhook(HOOK, ['one', 'two'], { mentionIds: ['511111111111111111'], fetchFn })
    expect(ids).toHaveLength(2)
    expect(calls(fetchFn)).toEqual([
      {
        method: 'POST',
        path: '?wait=true',
        body: { content: 'one', allowed_mentions: { parse: [], users: ['511111111111111111'] } },
      },
      {
        method: 'POST',
        path: '?wait=true',
        body: { content: 'two', allowed_mentions: { parse: [], users: ['511111111111111111'] } },
      },
    ])
  })

  test('posting again edits the earlier messages and deletes the ones no longer needed', async () => {
    const fetchFn = fakeDiscord()
    const ids = await postToWebhook(HOOK, ['shorter'], { previousIds: ['11', '12'], fetchFn })
    expect(ids).toEqual(['11'])
    expect(calls(fetchFn)).toEqual([
      {
        method: 'PATCH',
        path: '/messages/11',
        body: { content: 'shorter', allowed_mentions: { parse: [], users: [] } },
      },
      { method: 'DELETE', path: '/messages/12', body: null },
    ])
  })

  test('a message deleted in Discord is posted again', async () => {
    const fetchFn = fakeDiscord({ status: 404, body: {} }, { body: { id: '99' } })
    expect(await postToWebhook(HOOK, ['again'], { previousIds: ['11'], fetchFn })).toEqual(['99'])
  })

  test('a deleted webhook asks for a new one', async () => {
    const fetchFn = fakeDiscord({ status: 404, body: {} })
    await expect(postToWebhook(HOOK, ['hi'], { fetchFn })).rejects.toThrow(/Paste a new webhook URL/)
  })

  test('a short rate limit is waited out once', async () => {
    const fetchFn = fakeDiscord({ status: 429, body: { retry_after: 0.01 } }, { body: { id: '7' } })
    expect(await postToWebhook(HOOK, ['hi'], { fetchFn })).toEqual(['7'])
  })

  test('no connection gives a plain message', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(postToWebhook(HOOK, ['hi'], { fetchFn })).rejects.toThrow(/Could not reach Discord/)
  })
})

describe('deleteFromWebhook', () => {
  test('deletes every message, skipping ones already gone', async () => {
    const fetchFn = fakeDiscord({ status: 404, body: {} }, {})
    await deleteFromWebhook(HOOK, ['11', '12'], { fetchFn })
    expect(calls(fetchFn).map((c) => c.path)).toEqual(['/messages/11', '/messages/12'])
  })
})
