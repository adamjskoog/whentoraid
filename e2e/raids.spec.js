import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/lib/seed.js'

const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('whentoraid-v3')))

test('demo replacement generates a new year and retains January after reload', async ({ page }, testInfo) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Explore the demo guild' }).click()
  await expect(page.getByRole('heading', { name: 'Find your next raid night.' })).toBeVisible()
  const first = await saved(page)
  expect(Object.keys(first.weeks).length).toBeGreaterThanOrEqual(53)
  expect(first.settings.raids.map((raid) => raid.size)).toEqual([10, 10, 20])

  await page.getByRole('button', { name: /Guild settings/ }).click()
  await page.getByRole('button', { name: 'Replace with the demo guild' }).click()
  await page.getByRole('button', { name: 'Click again to replace your guild' }).click()
  await expect(page.getByRole('heading', { name: 'Find your next raid night.' })).toBeVisible()
  const second = await saved(page)
  expect(second.weeks).not.toEqual(first.weeks)
  const january = Object.keys(second.weeks).sort()[0]
  await page.goto(`./#/planner/${january}/raid-10-1`)
  await page.reload()
  await expect(
    page.getByRole('button', { name: '10-player Raid 1 · 10 players', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  const reloaded = await saved(page)
  expect(reloaded.weeks[january].checkins).toEqual(second.weeks[january].checkins)
  expect(Object.keys(reloaded.weeks[january].plans)).toHaveLength(3)
  await page.screenshot({ path: testInfo.outputPath('demo-year.png'), fullPage: true })
})

test('composition and saved rosters survive switching raids and reloading', async ({ page }) => {
  await page.addInitScript((state) => {
    if (!localStorage.getItem('whentoraid-v3')) localStorage.setItem('whentoraid-v3', JSON.stringify(state))
  }, createSeedState())
  await page.goto('./')
  await page.getByRole('button', { name: '↻ Rebuild roster' }).click()
  const before = await saved(page)
  await page.getByRole('button', { name: '10-player Raid 1 · 10 players', exact: true }).click()
  await page.getByRole('button', { name: /Guild settings/ }).click()
  await page.getByLabel('Tank slots', { exact: true }).fill('1')
  await page.getByLabel('Healer slots', { exact: true }).fill('3')
  await page.getByLabel('Raid name', { exact: true }).fill('First raid')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('heading', { name: 'Find your next raid night.' })).toBeVisible()
  const after = await saved(page)
  expect(after.settings.raids[0].targets).toEqual([1, 3, 6])
  expect(after.settings.raids[1].targets).toEqual([2, 2, 6])
  expect(after.weeks[after.currentWeek].plans['raid-20']).toEqual(
    before.weeks[before.currentWeek].plans['raid-20'],
  )
  await page.getByRole('button', { name: '20-player Raid · 20 players', exact: true }).click()
  await page.getByRole('button', { name: 'First raid · 10 players', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'First raid · 10 players', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect((await saved(page)).weeks).toEqual(after.weeks)
})
