import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/lib/seed.js'

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-0123456789'

test('an officer connects a Discord channel and posts the published roster there', async ({ page }) => {
  // A stand-in for Discord that records every webhook call.
  const requests = []
  let nextId = 1300000000000000001n
  await page.route('https://discord.com/api/webhooks/**', async (route) => {
    const request = route.request()
    requests.push({ method: request.method(), url: request.url(), body: request.postDataJSON() })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ id: String(nextId++) }),
    })
  })
  // Only on the first load, so reloading keeps the published roster.
  await page.addInitScript((state) => {
    if (!localStorage.getItem('whentoraid-v3')) localStorage.setItem('whentoraid-v3', JSON.stringify(state))
  }, createSeedState())
  await page.goto('./#/settings')

  await page.getByLabel('Webhook URL').fill(HOOK)
  await page.getByRole('button', { name: 'Save channel' }).click()
  await expect(page.getByText('Discord channel saved.')).toBeVisible()
  await page.getByRole('button', { name: 'Send test message' }).click()
  await expect(page.getByText('Test message sent.')).toBeVisible()
  expect(requests[0].body.content).toContain('WhenToRaid is connected')

  await page.goto('./#/planner')
  await page.getByRole('button', { name: 'Publish roster' }).click()
  await page.getByRole('button', { name: 'Post to Discord' }).click()
  await expect(page.getByText('Roster posted to Discord.')).toBeVisible()
  expect(requests[1]).toMatchObject({ method: 'POST', url: `${HOOK}?wait=true` })
  expect(requests[1].body.content).toContain('**PUBLISHED ROSTER**')
  expect(requests[1].body.allowed_mentions).toEqual({ parse: [], users: [] })

  // The post is remembered across reloads, and updating it edits the same message.
  await page.reload()
  await page.getByRole('button', { name: 'Update Discord post' }).click()
  await expect(page.getByText('Discord post updated.')).toBeVisible()
  expect(requests[2]).toMatchObject({ method: 'PATCH', url: `${HOOK}/messages/1300000000000000002` })
})
