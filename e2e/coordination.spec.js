import { expect, test } from '@playwright/test'
import { createSeedState, SEED_WEEK } from '../src/lib/seed.js'
import { expand, navigate } from './helpers.js'

const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('whentoraid-v3')))

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-28T12:00:00Z'))
  await page.addInitScript((state) => {
    if (!localStorage.getItem('whentoraid-v3')) localStorage.setItem('whentoraid-v3', JSON.stringify(state))
  }, createSeedState())
})

test('officers see upcoming raids that need attention and a month calendar', async ({ page }) => {
  await page.goto('./#/home')
  const dashboard = page.getByRole('region', { name: 'Officer dashboard' })
  await expect(dashboard.getByRole('heading', { name: 'Upcoming raids' })).toBeVisible()
  await expect(dashboard.getByText('6 need attention')).toBeVisible()
  await expect(dashboard.getByText('Not planned yet').first()).toBeVisible()
  await dashboard.getByRole('button', { name: /^Open 20-player Raid, week of Sep 28/ }).click()
  await expect(page.getByRole('heading', { name: '20-player Raid', level: 1 })).toBeVisible()
  await expect(page.getByText(/2026 · .* guild time/)).toBeVisible()
  await navigate(page, 'My raids')
  await expect(
    page.getByRole('region', { name: 'Raid calendar' }).getByRole('heading', { name: 'September 2026' }),
  ).toBeVisible()
})

test('a weekly schedule creates drafts without publishing, and rules are saved per raid', async ({
  page,
}) => {
  await page.goto('./#/settings')
  await expand(page, 'Roster rules')
  await page.getByRole('spinbutton', { name: 'Mage' }).fill('1')
  await page.getByRole('button', { name: 'Save roster rules' }).click()
  await expect(page.getByText('Roster rules saved for 20-player Raid.')).toBeVisible()
  const rules = (await saved(page)).settings.raids.find((r) => r.id === 'raid-20').rules
  expect(rules.classLimits).toEqual({ Mage: 1 })

  await expand(page, 'Weekly schedule')
  await page.getByRole('combobox', { name: 'Day', exact: true }).selectOption({ label: 'Fri' })
  await page.getByLabel('Start time').first().fill('18:00')
  await page.getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.getByText('Weekly schedule saved for 20-player Raid.')).toBeVisible()
  await page.getByRole('button', { name: 'Create drafts for upcoming dates' }).click()
  await expect(page.getByText(/draft raids created\. Nothing was published or sent\./)).toBeVisible()
  const state = await saved(page)
  const drafts = Object.values(state.weeks)
    .map((week) => week.plans['raid-20'])
    .filter(Boolean)
  expect(drafts.length).toBeGreaterThan(5)
  expect(drafts.every((plan) => plan.published === null && plan.team.length === 0)).toBe(true)

  await page.getByRole('button', { name: 'Cancel this week' }).first().click()
  await expect(page.getByText('This week is cancelled in the schedule.')).toBeVisible()
  await navigate(page, 'My raids')
  // The first scheduled Friday is October 2; the calendar opens on September.
  const calendar = page.getByRole('region', { name: 'Raid calendar' })
  await calendar.getByRole('button', { name: 'Next month' }).click()
  await expect(calendar.getByRole('button', { name: /20-player Raid.*Cancelled/ })).toBeVisible()
  await expect(calendar.getByRole('button', { name: /20-player Raid.*Draft/ }).first()).toBeVisible()
})

test('players mark tentative times and away dates without losing their usual times', async ({ page }) => {
  await page.goto('./#/availability')
  await page.getByRole('button', { name: 'Paint grid', exact: true }).click()
  await page.getByRole('button', { name: 'Tentative', exact: true }).click()
  await page
    .getByRole('button', { name: /not tentative/ })
    .first()
    .click()
  let checkin = (await saved(page)).weeks[SEED_WEEK].checkins.m0
  expect(checkin.tentativeRanges).toHaveLength(1)

  const before = checkin.ranges
  await expand(page, 'Away dates')
  await page.getByLabel('From', { exact: true }).fill(SEED_WEEK)
  await page.getByLabel('To', { exact: true }).fill('2026-09-29')
  await page.getByRole('button', { name: 'Mark away' }).click()
  await expect(page.getByText('Away this week: Sep 28, Sep 29.')).toBeVisible()
  checkin = (await saved(page)).weeks[SEED_WEEK].checkins.m0
  expect(checkin.absentDates).toEqual([SEED_WEEK, '2026-09-29'])
  expect(checkin.ranges).toEqual(before)

  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByText(/Away this week/)).toBeHidden()
})

test('a published roster link opens the published view', async ({ page }) => {
  await page.goto(`./#/published/${SEED_WEEK}/raid-20`)
  await expect(page.getByText('PUBLISHED RAID')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No published roster yet' })).toBeVisible()
})

test('the demo is offered at the top of setup', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('whentoraid-v3'))
  await page.goto('./')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  await expect(page.getByText(/Demo guild loaded/)).toBeVisible()
})
