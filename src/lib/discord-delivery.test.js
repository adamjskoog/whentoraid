import { beforeEach, describe, expect, test, vi } from 'vitest'

const calls = []
vi.mock('./remote/client.js', () => ({ supabase: {} }))
vi.mock('./remote/sync.svelte.js', () => ({
  remote: { guildId: 'g1' },
  flushOnlineChanges: vi.fn(async () => calls.push('flush')),
}))
vi.mock('./discord-channel.svelte.js', () => ({
  loadDiscordChannel: vi.fn(async () => calls.push('reload')),
}))
vi.mock('./raid-services.js', () => ({
  queueDiscordDelivery: vi.fn(async (_c, _g, _w, _r, action) => calls.push(`queue:${action}`)),
  dispatchDiscordDeliveries: vi.fn(async () => {
    calls.push('dispatch')
    return [{ id: 'd1', status: 'sent' }]
  }),
  listDiscordDeliveries: vi.fn(async () => [{ id: 'd1', status: 'sent' }]),
  retryDiscordDelivery: vi.fn(async () => calls.push('retry')),
}))

const services = await import('./raid-services.js')
const { delivery, deliveryStatus, needsRetry, queueAndSend, retryDelivery, sendQueued, watchDelivery } =
  await import('./discord-delivery.svelte.js')

beforeEach(() => {
  calls.length = 0
})

describe('server Discord delivery', () => {
  test('a post saves pending edits first, then queues and sends it', async () => {
    await watchDelivery('2026-10-12', 'raid-20')
    calls.length = 0
    expect(await queueAndSend('2026-10-12', 'raid-20', 'post')).toBe('Sent to Discord.')
    expect(calls.slice(0, 3)).toEqual(['flush', 'queue:post', 'flush'])
    expect(calls).toContain('dispatch')
    expect(delivery.latest).toEqual({ id: 'd1', status: 'sent' })
  })

  test('an uncertain send is reported so the officer checks Discord before retrying', async () => {
    services.dispatchDiscordDeliveries.mockResolvedValueOnce([
      { id: 'd1', status: 'uncertain', error: 'Delivery may have succeeded. Check Discord before retrying.' },
    ])
    expect(await sendQueued('2026-10-12', 'raid-20')).toMatch(/Check Discord/)
  })

  test('a refused queue (e.g. not published) is shown and nothing is sent', async () => {
    services.queueDiscordDelivery.mockRejectedValueOnce(
      new Error('Save and publish this roster before posting it.'),
    )
    expect(await queueAndSend('2026-10-12', 'raid-20', 'post')).toMatch(/publish this roster/)
    expect(calls).not.toContain('dispatch')
  })

  test('when the worker is unavailable the message stays queued', async () => {
    services.dispatchDiscordDeliveries.mockRejectedValueOnce(
      new Error('The message is queued but could not be sent yet.'),
    )
    expect(await sendQueued('2026-10-12', 'raid-20')).toMatch(/queued/)
  })

  test('retry re-queues the latest delivery and sends it', async () => {
    delivery.latest = { id: 'd1', status: 'failed', last_error: 'Discord returned 500.' }
    await retryDelivery('2026-10-12', 'raid-20')
    expect(calls).toContain('retry')
    expect(calls).toContain('dispatch')
  })

  test('status words and retry offers follow the delivery state', () => {
    expect(deliveryStatus({ status: 'sent' })).toBe('')
    expect(deliveryStatus({ status: 'pending', last_error: 'Discord returned 429.' })).toMatch(
      /waiting to retry/,
    )
    expect(deliveryStatus({ status: 'uncertain' })).toMatch(/Check the channel/)
    expect(needsRetry({ status: 'failed' })).toBe(true)
    expect(needsRetry({ status: 'pending' })).toBe(false)
  })

  test('a status reload for a raid no longer on screen is dropped', async () => {
    await watchDelivery('2026-10-12', 'raid-20')
    services.listDiscordDeliveries.mockImplementation(async (_c, _g, _w, raidId) =>
      raidId === 'raid-20' ? [{ id: 'old', status: 'failed' }] : [{ id: 'new', status: 'sent' }],
    )
    const slow = sendQueued('2026-10-12', 'raid-20')
    await watchDelivery('2026-10-12', 'raid-10-1')
    await slow
    expect(delivery.key).toContain('raid-10-1')
    expect(delivery.latest?.id).toBe('new')
    services.listDiscordDeliveries.mockImplementation(async () => [{ id: 'd1', status: 'sent' }])
  })
})
