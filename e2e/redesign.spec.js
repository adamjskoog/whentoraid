import { expect, test } from '@playwright/test'
import { createSeedState, SEED_WEEK } from '../src/lib/seed.js'
import { navigate } from './helpers.js'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-28T12:00:00Z'))
  await page.addInitScript(
    (state) => localStorage.setItem('whentoraid-v3', JSON.stringify(state)),
    createSeedState(),
  )
})

test('the planner brings each task into view and tabs work from the keyboard', async ({ page, isMobile }) => {
  await page.goto('./#/planner')
  const first = page.getByRole('button', { name: /TOP SUGGESTION/ })
  expect((await first.boundingBox()).y).toBeLessThan(await page.evaluate(() => innerHeight))
  if (isMobile) await page.getByRole('tab', { name: /^Roster/ }).click()
  else {
    await page.getByRole('tab', { name: 'Schedule' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: /^Roster/ })).toBeFocused()
  }
  await expect(first).toBeHidden()
  await expect(page.getByRole('button', { name: 'Edit Stoneguard' })).toBeVisible()
  const roster = await page.getByRole('heading', { name: 'Your raid roster' }).boundingBox()
  expect(roster.y).toBeLessThan(await page.evaluate(() => innerHeight))
  await page.getByRole('tab', { name: 'Responses' }).click()
  await expect(page.getByRole('heading', { name: 'Publish before collecting responses' })).toBeVisible()
})

test('collapsed days can be edited and copied without losing existing availability', async ({ page }) => {
  await page.goto('./#/availability')
  await page.getByRole('button', { name: 'Time ranges', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Fri from', exact: true })).toBeHidden()
  await page.getByLabel('Edit Fri availability', { exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Fri from', exact: true })).toBeVisible()
  const before = await page.evaluate(
    (week) => JSON.parse(localStorage.getItem('whentoraid-v3')).weeks[week].checkins.m0,
    SEED_WEEK,
  )
  await page.getByRole('combobox', { name: 'Copy Fri times to', exact: true }).selectOption('1')
  await page.getByRole('button', { name: 'Copy Fri times', exact: true }).click()
  await expect(page.getByText('Fri times added to Tue. Existing times were kept.')).toBeVisible()
  const copied = await page.evaluate(
    (week) => JSON.parse(localStorage.getItem('whentoraid-v3')).weeks[week].checkins.m0,
    SEED_WEEK,
  )
  expect(copied.ranges).not.toEqual(before.ranges)
  expect(
    before.ranges.every((previous) =>
      copied.ranges.some((range) => range.start <= previous.start && range.end >= previous.end),
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  const after = await page.evaluate(
    (week) => JSON.parse(localStorage.getItem('whentoraid-v3')).weeks[week].checkins.m0,
    SEED_WEEK,
  )
  expect(after).toEqual(before)
})

test('a personal assignment opens the published roster even for an officer', async ({ page }) => {
  await page.goto('./#/planner')
  await page.getByRole('button', { name: 'Publish roster', exact: true }).click()
  await navigate(page, 'My raids')
  await expect(page.getByRole('region', { name: 'Getting ready to raid' })).toHaveCount(0)
  await page.getByRole('button', { name: 'View published roster', exact: true }).click()
  await expect(page.getByRole('tab', { name: /^Roster/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Edit Stoneguard' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'View published roster', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('phone navigation and character choices remain accessible without scrolling the week', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Phone navigation and availability sections')
  await page.goto('./#/availability')
  await page.getByRole('tab', { name: 'Raid & characters' }).click()
  await expect(page.getByRole('checkbox', { name: /Participate in/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Weekly availability' })).toBeHidden()
  await navigate(page, 'Guild members')
  await expect(page.getByRole('heading', { name: 'Guild members' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'More', exact: true })).toBeFocused()
})

test('narrow layouts with long guild and character names do not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 })
  await page.goto('./#/planner')
  const other = await page.context().newPage()
  await other.goto('./')
  await other.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('whentoraid-v3'))
    state.guild.name = 'The Exceptionally Long Guild Name for a Very Busy Raid Team'
    state.characters = state.characters.map((character) => ({
      ...character,
      name: 'ExtraordinarilyLongCharacterName',
    }))
    localStorage.setItem('whentoraid-v3', JSON.stringify(state))
  })
  await navigate(page, 'My characters')
  await expect(page.getByRole('heading', { name: 'ExtraordinarilyLongCharacterName' }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'My characters', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  await other.close()
})
