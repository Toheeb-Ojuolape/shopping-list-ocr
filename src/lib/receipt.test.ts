import { describe, expect, it } from 'vitest'
import { mergeGeminiPayload } from './gemini'
import { buildSheetRows, createExcelHtml } from './googleSheets'
import { parseReceiptText, sumItems } from './receipt'

describe('receipt parsing', () => {
  it('extracts merchant, date, item rows, tax, and totals from OCR text', () => {
    const extraction = parseReceiptText(
      `
      FRESH MART
      04/19/2026 12:10
      BANANAS £1.25
      2x OAT MILK £4.50
      BREAD LOAF £2.10
      SUBTOTAL £7.85
      VAT £0.40
      TOTAL £8.25
      VISA APPROVED
      `,
      { defaultCurrency: 'GBP' },
    )

    expect(extraction.merchant).toBe('Fresh Mart')
    expect(extraction.purchasedAt).toBe('2026-04-19')
    expect(extraction.currency).toBe('GBP')
    expect(extraction.items).toHaveLength(3)
    expect(extraction.items.map((item) => item.name)).toEqual(['Bananas', 'Oat Milk', 'Bread Loaf'])
    expect(extraction.items[1]).toMatchObject({
      quantity: 2,
      unitPrice: 2.25,
      totalPrice: 4.5,
    })
    expect(extraction.subtotal).toBe(7.85)
    expect(extraction.tax).toBe(0.4)
    expect(extraction.total).toBe(8.25)
  })

  it('ignores payment rows and infers total from items when no total is visible', () => {
    const extraction = parseReceiptText(
      `
      Corner Shop
      Coffee 2.80
      Sandwich 4.25
      Mastercard 7.05
      Auth 123456
      `,
      { defaultCurrency: 'USD' },
    )

    expect(extraction.items.map((item) => item.name)).toEqual(['Coffee', 'Sandwich'])
    expect(extraction.total).toBe(7.05)
    expect(sumItems(extraction.items)).toBe(7.05)
  })
})

describe('Gemini merge normalization', () => {
  it('keeps validated Gemini rows while preserving fallback metadata', () => {
    const fallback = parseReceiptText('Market\nApples 1.20\nTotal 1.20', { defaultCurrency: 'GBP' })
    const merged = mergeGeminiPayload(
      {
        merchant: 'Market Hall',
        currency: 'GBP',
        items: [{ name: 'Pink Lady Apples', quantity: 1, totalPrice: 1.2 }],
      },
      fallback,
    )

    expect(merged.merchant).toBe('Market Hall')
    expect(merged.items).toHaveLength(1)
    expect(merged.items[0]).toMatchObject({
      name: 'Pink Lady Apples',
      unitPrice: 1.2,
      confidence: 0.92,
    })
  })
})

describe('sheet and Excel exports', () => {
  it('builds one Google Sheet row per receipt item', () => {
    const extraction = parseReceiptText('Grocer\nTea £3.25\nCake £2.75\nTotal £6.00', {
      defaultCurrency: 'GBP',
    })
    const rows = buildSheetRows(extraction, 'data:image/jpeg;base64,abc', '2026-06-06T10:00:00.000Z')

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      capturedAt: '2026-06-06T10:00:00.000Z',
      merchant: 'Grocer',
      itemName: 'Tea',
      totalPrice: 3.25,
      receiptTotal: 6,
      imageDataUrl: 'data:image/jpeg;base64,abc',
    })
  })

  it('escapes cell content in the Excel-compatible workbook', () => {
    const extraction = parseReceiptText('Shop\nMilk <large> £1.95\nTotal £1.95', {
      defaultCurrency: 'GBP',
    })
    const html = createExcelHtml({ ...extraction, merchant: 'A&B "Shop"' }, 'data:image/jpeg;base64,abc')

    expect(html).toContain('A&amp;B &quot;Shop&quot;')
    expect(html).toContain('Milk &lt;Large&gt;')
    expect(html).toContain('<img src="data:image/jpeg;base64,abc"')
  })
})
