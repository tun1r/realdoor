import { expect, test } from '@playwright/test'

// The welcome/understand/prepare layouts collapse to one column at 759px and
// below, and keep two columns above 1060px. Between those breakpoints the
// desktop rail (240px) plus the aside's 280px minimum used to squeeze the
// primary card below its content width, so its children overflowed the card
// and overlapped the aside. These widths pin that band.
const widths = [760, 768, 860, 1024, 1060] as const

test.describe('responsive layout band 760-1060px', () => {
  for (const width of widths) {
    test(`primary card holds its children at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')

      const layout = page.locator('.welcome-layout')
      await expect(layout).toBeVisible()

      const state = await layout.evaluate((el) => {
        const primary = el.querySelector('.welcome-primary')
        if (!primary) return null
        const primaryBox = primary.getBoundingClientRect()
        const overflow = Array.from(primary.querySelectorAll('*')).reduce(
          (max, child) => Math.max(max, child.getBoundingClientRect().right - primaryBox.right),
          0,
        )
        return {
          columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
          overflow,
        }
      })

      expect(state).not.toBeNull()
      expect(state!.columns).toBe(1)
      expect(state!.overflow).toBeLessThanOrEqual(1)
    })
  }

  test('keeps two columns on wide desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')

    const layout = page.locator('.welcome-layout')
    await expect(layout).toBeVisible()
    const columns = await layout.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
    )
    expect(columns).toBe(2)
  })
})
