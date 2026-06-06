import { expect, test } from '@playwright/test'
import path from 'node:path'

test('extracts a receipt, edits rows, saves to Google Sheets, and exports CSV', async ({ page }) => {
  const sheetRequests: unknown[] = []

  await page.route('https://script.google.com/**', async (route) => {
    const postData = route.request().postData()
    if (postData) {
      sheetRequests.push(JSON.parse(postData))
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  await page.goto('/')

  await page.getByTestId('receipt-upload').setInputFiles(
    path.join(process.cwd(), 'tests/e2e/fixtures/receipt.png'),
  )

  await expect(page.getByTestId('receipt-status')).toContainText('2 rows ready')
  await expect(page.getByLabel('Store')).toHaveValue('E2e Market')
  await expect(page.getByTestId('item-row').first().getByLabel('Item')).toHaveValue('Apples')
  await expect(page.getByTestId('item-row').nth(1).getByLabel('Item')).toHaveValue('Oat Milk')
  await expect(page.getByText('£5.50').first()).toBeVisible()

  const firstRow = page.getByTestId('item-row').first()
  await firstRow.getByLabel('Item').fill('Pink Lady Apples')
  await firstRow.getByLabel('Price').fill('2.55')

  await page.getByLabel('Apps Script link').fill('https://script.google.com/macros/s/e2e/exec')
  await page.getByLabel('Sheet tab').fill('E2E Receipts')
  await page.getByRole('button', { name: 'Save to Google Sheet' }).click()

  await expect(page.getByTestId('receipt-status')).toContainText('Saved to Google Sheet')
  expect(sheetRequests).toHaveLength(1)
  expect(sheetRequests[0]).toMatchObject({
    sheetName: 'E2E Receipts',
    rows: [
      expect.objectContaining({
        merchant: 'E2e Market',
        itemName: 'Pink Lady Apples',
        totalPrice: 2.55,
      }),
      expect.objectContaining({
        itemName: 'Oat Milk',
        totalPrice: 3.1,
      }),
    ],
  })

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download CSV' }).click()
  expect((await download).suggestedFilename()).toMatch(/receipt-.+\.csv/)
})
