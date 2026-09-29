import { expect, test } from '@playwright/test'

/** Each test starts from an empty browser profile, so the app opens on first-run setup. */

async function createGuild(page) {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Set up your guild' })).toBeVisible()
  await page.getByLabel('Guild name').fill('Night Shift')
  await page.getByLabel('Guild timezone').selectOption('America/New_York')
  await page.getByLabel('Your name').fill('Sam')
  await page.getByLabel('Character name').fill('Firstlight')
  await page.getByLabel('Realm').fill('Whitemane')
  await page.getByLabel('Class').selectOption('Priest')
  await page.getByLabel('Specialization').fill('Holy')
  await page.getByLabel('Raid role').selectOption('Healer')
  await page.getByRole('button', { name: 'Create guild' }).click()
  await expect(page.getByRole('heading', { name: 'Guild members' })).toBeVisible()
}

test('set up a guild, add a player, and check them in', async ({ page }) => {
  await createGuild(page)

  await page.getByRole('button', { name: '+ Add player' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Player name').fill('Nova')
  await dialog.getByLabel('Character name').fill('Starfall')
  await dialog.getByLabel('Realm').fill('Whitemane')
  await dialog.getByLabel('Class').selectOption('Mage')
  await dialog.getByLabel('Specialization').fill('Frost')
  await dialog.getByRole('button', { name: 'Add player' }).click()
  await expect(page.getByRole('rowheader', { name: /Nova/ })).toBeVisible()

  const novaRow = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Nova/ }) })
  await novaRow.getByRole('button', { name: 'Act as' }).click()

  await page.getByRole('button', { name: /My availability/ }).click()
  await page.getByRole('button', { name: 'Can’t make it this week' }).click()
  await expect(page.getByText('Checked in · not available this week')).toBeVisible()

  await page.getByRole('button', { name: /Raid planner/ }).click()
  await expect(page.getByRole('heading', { name: 'Waiting on 1' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Players who have not checked in' })).toHaveText('Sam')
})

test('the guild survives a reload and can be started over', async ({ page }) => {
  await createGuild(page)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Find your next raid night.' })).toBeVisible()
  await expect(page.locator('main > header')).toContainText('NIGHT SHIFT')

  await page.getByRole('button', { name: /Guild settings/ }).click()
  await page.getByRole('button', { name: 'Set up a new guild' }).click()
  await page.getByRole('button', { name: 'Click again to erase this guild' }).click()
  await expect(page.getByRole('heading', { name: 'Set up your guild' })).toBeVisible()
})
