import { expect, test } from '@playwright/test'

test('HH-002 completes the evidence, refusal, export, and deletion journey', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Make a renter packet you can inspect.' })).toBeVisible()
  await page.getByRole('button', { name: /HH-002/ }).click()
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
  await expect(page.getByText('Untrusted instruction warning')).toBeVisible()

  const sourceButton = page.getByRole('button', { name: /See source for Gross pay/ }).first()
  await sourceButton.click()
  await expect(page.getByRole('dialog', { name: 'Gross pay' })).toBeVisible()
  await expect(page.locator('.bbox-highlight')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sourceButton).toBeFocused()

  await page.getByRole('button', { name: 'Confirm all' }).click()
  await expect(page.getByText('All extracted fields are confirmed', { exact: false })).toBeAttached()

  await page.getByRole('button', { name: 'Understand' }).click()
  await expect(page.getByRole('heading', { name: 'Understand' })).toBeVisible()
  const ledger = page.locator('.arithmetic-ledger')
  await expect(ledger.getByText('$49,920', { exact: true })).toBeVisible()
  await expect(ledger.getByText('$82,320', { exact: true })).toBeVisible()

  await page.getByLabel('Your question').fill('Does this household qualify?')
  await page.getByRole('button', { name: 'Ask question' }).click()
  await expect(page.getByText(/a human makes any program determination/i)).toBeVisible()

  await page.getByRole('button', { name: 'Prepare' }).click()
  await expect(page.getByRole('heading', { name: 'Prepare' })).toBeVisible()
  await expect(page.getByText('NEEDS_REVIEW', { exact: true })).toBeVisible()
  await expect(page.getByText('PAY_STUB_TOTAL_CONFLICT', { exact: true })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download packet (.zip)' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^realdoor-.*\.zip$/)

  await page.getByRole('button', { name: 'Delete session' }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove this evidence desk?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete session' }).click()
  await expect(page.getByRole('heading', { name: 'Make a renter packet you can inspect.' })).toBeVisible()
})

test('the Evidence Desk reflows without horizontal page overflow', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /HH-005/ }).click()
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})
