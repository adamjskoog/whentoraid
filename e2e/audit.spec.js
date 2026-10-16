import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { createSeedState } from '../src/lib/seed.js'
import { navigate } from './helpers.js'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-28T12:00:00Z'))
  await page.addInitScript((state) => {
    if (!localStorage.getItem('whentoraid-v3')) localStorage.setItem('whentoraid-v3', JSON.stringify(state))
  }, createSeedState())
})

test('navigation names the page and moves keyboard focus to its heading', async ({ page }) => {
  await page.goto('./#/planner')
  await navigate(page, 'My characters')
  await expect(page).toHaveTitle('My characters · The After Hours · WhenToRaid')
  await expect(page.getByRole('heading', { name: 'My characters', exact: true })).toBeFocused()
  await navigate(page, 'Guild members')
  await expect(page).toHaveTitle('Guild members · The After Hours · WhenToRaid')
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'My characters', exact: true })).toBeFocused()
})

test('dialogs have a name, contain validation errors, and restore focus on Escape', async ({ page }) => {
  await page.goto('./#/characters')
  const edit = page.getByRole('button', { name: 'Edit character', exact: true }).first()
  await edit.click()
  const dialog = page.getByRole('dialog', { name: 'Edit character', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Character name', { exact: true }).fill('   ')
  await dialog.getByRole('button', { name: 'Save character' }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(edit).toBeFocused()
})

test('editing another tab preserves the active player', async ({ page, context }) => {
  await page.goto('./#/characters')
  const other = await context.newPage()
  await other.goto('./#/characters')
  await other.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('whentoraid-v3'))
    state.currentMemberId = 'm1'
    state.guild.name = 'Updated by another officer'
    localStorage.setItem('whentoraid-v3', JSON.stringify(state))
  })
  await expect(page).toHaveTitle(/Updated by another officer/)
  await expect(page.getByRole('heading', { name: 'Stoneguard', exact: true })).toBeVisible()
  await other.close()
})

test('phone form controls stay readable and pages fit at 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 })
  for (const view of ['availability', 'members', 'settings']) {
    await page.goto(`./#/${view}`)
    await page.locator('#content h1').waitFor()
    const sizing = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      small: [
        ...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), select, textarea'),
      ]
        .filter((el) => el.getClientRects().length && parseFloat(getComputedStyle(el).fontSize) < 16)
        .map((el) => el.getAttribute('aria-label') ?? el.name),
    }))
    expect(sizing.width).toBe(320)
    expect(sizing.small).toEqual([])
  }
})

test('a malformed backup cannot replace the current guild', async ({ page }) => {
  await page.goto('./#/settings')
  const malformed = createSeedState()
  delete malformed.guild.name
  await page.getByRole('tab', { name: 'Backups', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(malformed)),
  })
  await expect(
    page.getByRole('status').filter({ hasText: 'That file is not a WhenToRaid backup' }),
  ).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('whentoraid-v3')).guild.name)).toBe(
    'The After Hours',
  )
})

test('the first installed app shell can reload offline with the saved guild', async ({ page, context }) => {
  await page.goto('./#/characters')
  await page.getByRole('heading', { name: 'My characters', exact: true }).waitFor()
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Stoneguard', exact: true })).toBeVisible()
  await context.setOffline(false)
})

test('a storage failure offers a downloadable copy of the current edits', async ({ page }) => {
  await page.goto('./#/characters')
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'whentoraid-v3') throw new DOMException('Storage full', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: 'Edit character', exact: true }).first().click()
  await page.getByLabel('Character name', { exact: true }).fill('RecoveredCharacter')
  await page.getByRole('button', { name: 'Save character' }).click()
  await expect(page.getByText('Your changes are not saved in this browser.')).toBeVisible()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download backup', exact: true }).click()
  const download = await downloading
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(backup.characters.find((character) => character.id === 'c0a').name).toBe('RecoveredCharacter')
})
