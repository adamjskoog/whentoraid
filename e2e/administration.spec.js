import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/lib/seed.js'
import { expand } from './helpers.js'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-28T12:00:00Z'))
  await page.addInitScript(
    (state) => localStorage.setItem('whentoraid-v3', JSON.stringify(state)),
    createSeedState(),
  )
})

test('settings tabs preserve edits and expose backup tools directly', async ({
  page,
  isMobile,
}, testInfo) => {
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
  await page.goto('./#/settings')
  await page.getByLabel('Guild name', { exact: true }).fill('Night Shift')
  const connections = page.getByRole('tab', { name: 'Connections' })
  if (isMobile) await connections.click()
  else {
    await page.getByRole('tab', { name: 'Raid rules' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(connections).toBeFocused()
  }
  await expect(page.getByLabel('Webhook URL')).toBeVisible()
  await expect(page.getByLabel('Guild name', { exact: true })).toBeHidden()
  await expect(page.getByText('You have unsaved raid rules.')).toBeVisible()
  await page.getByRole('tab', { name: 'Backups' }).click()
  const backup = page.getByRole('button', { name: 'Download backup (.json)' })
  await expect(backup).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('settings-backups.png'), fullPage: true })
  await page.getByRole('button', { name: 'Review changes' }).click()
  await expect(page.getByRole('tabpanel', { name: 'Raid rules' })).toBeFocused()
  await expect(page.getByLabel('Guild name', { exact: true })).toHaveValue('Night Shift')
  await page.getByRole('button', { name: 'Discard edits' }).click()
  await expect(page.getByLabel('Guild name', { exact: true })).toHaveValue('The After Hours')
  await expect(page.getByText('No pending edits')).toBeVisible()
  await expect(page.getByRole('tabpanel', { name: 'Raid rules' })).toBeFocused()
})

test('saving reveals and focuses an invalid field in a collapsed settings section', async ({ page }) => {
  await page.goto('./#/settings')
  await expand(page, 'Discord access')
  await page.getByLabel('Discord server ID', { exact: true }).fill('not-a-discord-id')
  await page.locator('summary').filter({ hasText: 'Discord access' }).click()
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByLabel('Discord server ID', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Discord server ID', { exact: true })).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Guild settings' })).toBeVisible()
})

test('the member directory filters, clears, and changes weeks on desktop and phones', async ({
  page,
  isMobile,
}, testInfo) => {
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
  await page.goto('./#/members')
  await page.screenshot({ path: testInfo.outputPath('members-viewport.png') })
  await page.getByLabel('Search players or characters').fill('Stoneguardalt')
  await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption('Healer')
  await expect(page.getByRole('rowheader', { name: /Adam/ })).toBeVisible()
  await page.getByRole('combobox', { name: 'Check-in', exact: true }).selectOption('waiting')
  await expect(page.getByText('No players match these filters.')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByLabel('Search players or characters')).toBeFocused()
  await expect(page.getByRole('rowheader')).toHaveCount(24)
  await page.screenshot({ path: testInfo.outputPath('members.png'), fullPage: true })
  await page.getByLabel('Week beginning').fill('2026-10-07')
  await page.getByLabel('Week beginning').blur()
  await expect(page.getByLabel('Week beginning')).toHaveValue('2026-10-05')
  await expect(page.getByText('0 of 24 players checked in · 24 waiting')).toBeVisible()
  await expect(page.getByText('Waiting', { exact: true })).toHaveCount(24)
})

test('administration screens fit a 320px phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 780 })
  await page.goto('./#/members')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  await page.screenshot({ path: testInfo.outputPath('320-members.png'), fullPage: true })
  await page.screenshot({ path: testInfo.outputPath('320-members-viewport.png') })
  await page.goto('./#/settings')
  await page.getByLabel('Guild name', { exact: true }).fill('A longer guild name to check wrapping')
  for (const label of ['Raid rules', 'Connections', 'Backups']) {
    await page.getByRole('tab', { name: label }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
    await page.screenshot({
      path: testInfo.outputPath(`320-settings-${label.toLowerCase().replaceAll(' ', '-')}.png`),
      fullPage: true,
    })
  }
})
