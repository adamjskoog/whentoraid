import { expand, navigate } from './helpers.js'
import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/lib/seed.js'

test.beforeEach(async ({ page }) => {
  // A stable fixture keeps roster assertions independent from the randomized demo.
  await page.addInitScript(
    (state) => localStorage.setItem('whentoraid-v3', JSON.stringify(state)),
    createSeedState(),
  )
  await page.goto('./#/planner')
  await expect(page.getByRole('region', { name: 'Roster publication' })).toBeVisible()
})

test('the demo week suggests a full raid and groups the bench', async ({ page }) => {
  const top = page.getByRole('button', { name: /TOP SUGGESTION/ })
  await expect(top).toContainText('20 / 20 roles filled')
  await page.getByRole('tab', { name: /^Roster/ }).click()
  await expand(page, 'On the bench')
  await expect(page.getByRole('heading', { name: /Free for this session/ })).toBeVisible()
})

test('record attendance after the raid', async ({ page }) => {
  await expect(page.getByText(/After the raid/)).toHaveCount(0)
  await navigate(page, 'Guild settings')
  await expand(page, 'Attendance')
  await page.getByRole('checkbox', { name: 'Track attendance after each raid' }).check()
  await page.getByRole('button', { name: 'Save settings' }).click()

  await page.getByRole('tab', { name: /^Roster/ }).click()
  await expand(page, 'After the raid')
  const group = page.getByRole('group', { name: 'Attendance for Stoneguard' })
  await group.getByRole('button', { name: 'Late' }).click()
  await expect(group.getByRole('button', { name: 'Late' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(/1 of 20 recorded/)).toBeVisible()

  await navigate(page, 'Guild members')
  const adam = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Adam/ }) })
  await expect(adam).toContainText('0 attended · 1 late · 0 no-show')
})

test('next week is empty, and the reminder is ready to copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: /^Next week/ }).click()
  await expect(page.getByRole('heading', { name: 'Waiting on 24' })).toBeVisible()
  await page.getByRole('button', { name: 'Copy reminder for Discord' }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('Still waiting on: Adam, Briar')
  expect(copied).toMatch(/<t:\d+:F>/)
})

test('download the raid as a calendar file', async ({ page }) => {
  await page.getByRole('tab', { name: /^Roster/ }).click()
  await expand(page, 'Share & export')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Add to calendar (.ics)' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('whentoraid-raid-20-2026-09-28.ics')
})

test('the availability map can be driven from the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Keyboard navigation is a desktop concern')
  await expand(page, 'Explore guild availability')
  const map = page.locator('.heatmap')
  await map.locator('.cell[tabindex="0"]').focus()
  const start = await page.evaluate(() => document.activeElement.dataset.day)
  await page.keyboard.press('ArrowRight')
  const next = await page.evaluate(() => document.activeElement.dataset.day)
  expect(Number(next)).toBe(Math.min(Number(start) + 1, 6))

  await page.getByRole('button', { name: 'Healers', exact: true }).click()
  await expect(map.locator('.cell').first()).toHaveAttribute('aria-label', /healers can stay/)
})

test('Back with unsaved guild settings stays put until the changes are discarded', async ({ page }) => {
  await navigate(page, 'Guild settings')
  await page.getByLabel('Guild name').fill('Renamed')

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Guild settings' })).toBeVisible()
  await expect(page).toHaveURL(/#\/settings\//)
  await expect(page.getByText(/You have unsaved guild settings/)).toBeVisible()

  await page.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page.getByRole('region', { name: 'Roster publication' })).toBeVisible()
  await expect(page).toHaveURL(/#\/planner\//)
})
