/** Use the same navigation on desktop and the phone's More menu. */
export async function navigate(page, label) {
  const destination = page.getByRole('button', { name: label, exact: true })
  if (!(await destination.isVisible())) await page.getByRole('button', { name: 'More', exact: true }).click()
  await destination.click()
}

export async function expand(page, title) {
  const summary = page.locator('summary').filter({ hasText: title }).first()
  const details = summary.locator('..')
  if (!(await details.evaluate((element) => element.open))) await summary.click()
}
