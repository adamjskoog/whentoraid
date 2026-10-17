import { navigate } from './helpers.js'
import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/lib/seed.js'

test('a player marks tentative, confirms, then reports a problem for an officer to replace', async ({
  page,
}) => {
  // The fixture's week, before its raid nights, so the published raid is still upcoming.
  await page.clock.setFixedTime(new Date('2026-09-28T12:00:00Z'))
  await page.addInitScript(
    (state) => localStorage.setItem('whentoraid-v3', JSON.stringify(state)),
    createSeedState(),
  )
  await page.goto('./#/planner')
  await page.getByRole('button', { name: 'Publish roster' }).click()

  // As the player (the fixture's current member is on the roster).
  await page.getByRole('button', { name: /My raids/ }).click()
  const next = page.getByRole('region', { name: 'Next raid assignment' })
  await expect(next.getByText('YOU’RE ROSTERED')).toBeVisible()
  await next.getByRole('button', { name: 'Tentative' }).click()
  await expect(next.getByText(/You’re tentative/)).toBeVisible()

  await navigate(page, 'Raid planner')
  await page.getByRole('tab', { name: 'Responses' }).click()
  const responses = page.getByRole('region', { name: 'Player responses' })
  await expect(responses).toContainText('0 confirmed · 1 tentative')
  await expect(responses).toContainText('Tentative:')

  await page.getByRole('button', { name: /My raids/ }).click()
  await next.getByRole('button', { name: 'I’ll be there' }).click()
  await expect(next.getByText('You confirmed you’ll be there.')).toBeVisible()
  await next.getByRole('button', { name: 'I can’t make it' }).click()
  await next.getByLabel(/What’s changed/).fill('Working late')
  await next.getByRole('button', { name: 'Tell the officers' }).click()
  await expect(next.getByText(/can’t make it: “Working late”/)).toBeVisible()

  // As the officer.
  await navigate(page, 'Raid planner')
  await page.getByRole('tab', { name: 'Responses' }).click()
  await expect(responses).toContainText('0 confirmed · 0 tentative')
  await expect(responses).toContainText('1 can’t make it')
  await expect(responses).toContainText('Working late')
  await responses.getByRole('button', { name: /Find a replacement for/ }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: /^Replace / })).toBeVisible()
})
