import { expect, test } from '@playwright/test'
import path from 'node:path'

test('extracts a receipt, edits rows, saves to Google Sheets, and exports CSV', async ({
  page,
}) => {
  const sheetRequests: unknown[] = []

  await page.route('https://accounts.google.com/gsi/client', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.google = {
          accounts: {
            oauth2: {
              initTokenClient: function(config) {
                return {
                  requestAccessToken: function() {
                    config.callback({ access_token: 'e2e-access-token' });
                  }
                };
              }
            }
          }
        };
      `,
    })
  })

  await page.route('https://ipapi.co/json/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ country_code: 'US', currency: 'USD' }),
    })
  })

  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const request = route.request()
    const url = request.url()
    const postData = request.postData()

    if (postData && url.includes(':append')) {
      sheetRequests.push(JSON.parse(postData))
    }

    if (request.method() === 'GET' && url.includes('fields=sheets.properties.title')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sheets: [{ properties: { title: 'E2E Receipts' } }],
        }),
      })
      return
    }

    if (request.method() === 'GET' && url.includes('/values/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ values: [['Receipt ID']] }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ updates: { updatedRows: 2 } }),
    })
  })

  await page.goto('/')

  await page
    .getByTestId('receipt-upload')
    .setInputFiles(path.join(process.cwd(), 'tests/e2e/fixtures/receipt.png'))

  await expect(page.getByTestId('receipt-status')).toContainText('2 rows ready')
  await expect(page.getByRole('combobox', { name: 'Store' })).toHaveValue('Aldi')
  await expect(page.getByTestId('item-row').first().getByLabel('Item')).toHaveValue('Apples')
  await expect(page.getByTestId('item-row').nth(1).getByLabel('Item')).toHaveValue('Oat Milk')
  await expect(page.getByText('£5.50').first()).toBeVisible()

  const firstRow = page.getByTestId('item-row').first()
  await firstRow.getByLabel('Item').fill('Pink Lady Apples')
  await firstRow.getByLabel('Price').fill('2.55')
  await expect(page.getByText('£5.65').first()).toBeVisible()

  await page
    .getByLabel('Google Sheet link')
    .fill('https://docs.google.com/spreadsheets/d/e2e-sheet-id/edit')
  await page.getByLabel('Sheet tab').fill('E2E Receipts')
  await page.getByRole('button', { name: 'Save to Google Sheet' }).click()

  await expect(page.getByTestId('receipt-status')).toContainText('Saved to Google Sheet')
  expect(sheetRequests).toHaveLength(1)
  expect(sheetRequests[0]).toMatchObject({
    values: [
      expect.arrayContaining(['']),
      expect.arrayContaining([expect.stringMatching(/^New receipt - \d{4}-\d{2}-\d{2}$/)]),
      expect.arrayContaining(['Aldi', 'Pink Lady Apples', 1, '', 2.55]),
      expect.arrayContaining(['Aldi', 'Oat Milk', 1, '', 3.1]),
    ],
  })

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download CSV' }).click()
  expect((await download).suggestedFilename()).toMatch(/receipt-.+\.csv/)
})
