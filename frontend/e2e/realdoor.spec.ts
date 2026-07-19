import { expect, test } from '@playwright/test'
import path from 'node:path'

async function expectNoAxeViolations(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  await page.addScriptTag({ path: path.resolve('node_modules/axe-core/axe.min.js') })
  const results = await page.evaluate(async () => {
    const axe = (window as Window & { axe?: { run: () => Promise<{ violations: Array<{ id: string }> }> } }).axe
    return axe ? axe.run() : { violations: [{ id: 'axe-not-loaded' }] }
  })
  expect(results.violations).toEqual([])
}

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

for (const [viewportName, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['mobile', { width: 320, height: 800 }],
] as const) {
test(`HH-005 replaces its one blocking employment letter with explicit confirmation (${viewportName})`, async ({ page }) => {
  const replacementPdf = path.resolve('../backend/tests/fixtures/hh-005_fresh_employment_letter.pdf')
  const issueMessage = "Under the challenge\u2019s frozen 60-day document-freshness convention, this employment letter needs replacement."
  const expectNoDocumentOverflow = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }

  await page.setViewportSize(viewport)
  await page.goto('/')
  await page.getByRole('button', { name: /HH-005/ }).click()
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
  await expectNoDocumentOverflow()
  await expectNoAxeViolations(page)
  await page.getByRole('button', { name: 'Confirm all' }).click()
  await expect(page.getByText('All extracted fields are confirmed', { exact: false })).toBeAttached()

  await page.getByRole('button', { name: 'Prepare' }).click()
  await expect(page.getByRole('heading', { name: 'Prepare' })).toBeVisible()
  await expect(page.getByText(issueMessage, { exact: true })).toBeVisible()
  await expect(page.getByText('EMPLOYMENT_LETTER_EXPIRED', { exact: true })).toBeVisible()
  await expectNoDocumentOverflow()
  const issueRow = page.locator('.reason-list li', { hasText: 'EMPLOYMENT_LETTER_EXPIRED' })
  await expect(issueRow).toContainText('Document date: 2026-04-14')

  const staleSource = page.getByRole('button', {
    name: 'View source for Document date in hh-005_d04_employment_letter.pdf, issue EMPLOYMENT_LETTER_EXPIRED',
  })
  await staleSource.click()
  await expect(page.getByRole('dialog', { name: 'Document date' })).toBeVisible()
  await expectNoDocumentOverflow()
  await expect(page.getByText('2026-04-14', { exact: true }).last()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(staleSource).toBeFocused()

  await page.getByRole('button', { name: 'Replace document' }).click()
  const replacementInput = page.getByLabel('Choose a replacement PDF for hh-005_d04_employment_letter.pdf')
  await replacementInput.setInputFiles(replacementPdf)
  await expect(page.getByRole('status').filter({ hasText: 'Extracting and validating replacement evidence' })).toHaveText('Extracting and validating replacement evidence')

  const pendingHeading = page.getByRole('heading', { name: 'hh-005_fresh_employment_letter.pdf' })
  await expect(pendingHeading).toBeVisible()
  await expect(pendingHeading).toBeFocused()
  await expect(page.getByText('Replacement awaiting renter confirmation.', { exact: true })).toBeVisible()
  await expectNoDocumentOverflow()
  const pendingSection = page.locator('section', { has: pendingHeading })
  const pendingSource = pendingSection.getByRole('button', { name: /See source for Document date/ })
  await pendingSource.click()
  await expect(page.getByRole('dialog', { name: 'Document date' })).toBeVisible()
  await expect(page.getByText('2026-07-12', { exact: true }).last()).toBeVisible()
  await expectNoDocumentOverflow()
  await page.keyboard.press('Escape')

  await pendingSection.getByRole('button', { name: 'Confirm replacement evidence' }).click()
  const readiness = page.getByLabel('Readiness result: READY_TO_REVIEW')
  await expect(readiness).toBeVisible()
  await expect(readiness).toBeFocused()
  await expect(page.getByText('No active review issues.', { exact: true })).toBeVisible()
  await expect(page.getByText('Ready for human review. No program determination was made.', { exact: true })).toBeVisible()
  await expect(page.getByText('$45,968', { exact: true })).toBeVisible()
  await expect(page.getByText('$111,120', { exact: true })).toBeVisible()
  await expectNoDocumentOverflow()

  await page.getByRole('button', { name: 'Profile' }).click()
  const oldHeading = page.getByRole('heading', { name: 'hh-005_d04_employment_letter.pdf' })
  const newHeading = page.getByRole('heading', { name: 'hh-005_fresh_employment_letter.pdf' })
  await expect(page.locator('section', { has: oldHeading }).getByText('Superseded', { exact: true })).toBeVisible()
  await expect(page.locator('section', { has: newHeading }).getByText('Active', { exact: true })).toBeVisible()
  await expectNoDocumentOverflow()
  await expectNoAxeViolations(page)

  await page.getByRole('button', { name: 'Prepare' }).click()
  await page.getByRole('checkbox', { name: /hh-005_fresh_employment_letter\.pdf/ }).uncheck()
  await expect(page.getByRole('status', { name: 'Packet completeness' })).toContainText('Incomplete packet')
  await expect(page.getByRole('status', { name: 'Packet completeness' })).toContainText('No submission.json will be included.')
  await expectNoDocumentOverflow()
})
}
