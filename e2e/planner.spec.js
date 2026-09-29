import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Explore the demo guild' }).click()
  await expect(page.getByRole('heading', { name: 'Find your next raid night.' })).toBeVisible()
})

test('the demo week suggests a full raid and groups the bench', async ({ page }) => {
  const top = page.getByRole('button', { name: /TOP SUGGESTION/ })
  await expect(top).toContainText('20 / 20 roles filled')
  await expect(page.getByRole('heading', { name: /Free for this session/ })).toBeVisible()
})

test('record attendance after the raid', async ({ page }) => {
  const group = page.getByRole('group', { name: 'Attendance for Stoneguard' })
  await group.getByRole('button', { name: 'Late' }).click()
  await expect(group.getByRole('button', { name: 'Late' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(/1 of 20 recorded/)).toBeVisible()

  await page.getByRole('button', { name: /Guild members/ }).click()
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
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Add to calendar (.ics)' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('whentoraid-2026-09-28.ics')
})

test('the availability map can be driven from the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Keyboard navigation is a desktop concern')
  const map = page.locator('.heatmap')
  await map.locator('.cell[tabindex="0"]').focus()
  const start = await page.evaluate(() => document.activeElement.dataset.day)
  await page.keyboard.press('ArrowRight')
  const next = await page.evaluate(() => document.activeElement.dataset.day)
  expect(Number(next)).toBe(Math.min(Number(start) + 1, 6))

  await page.getByRole('button', { name: 'Healers', exact: true }).click()
  await expect(map.locator('.cell').first()).toHaveAttribute('aria-label', /healers can stay/)
})
