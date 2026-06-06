import { describe, expect, it } from 'vitest'
import { mergeGeminiPayload } from './gemini'
import {
  buildReceiptAppendValues,
  buildSheetRows,
  createReceiptCsv,
  parseSpreadsheetId,
} from './googleSheets'
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

  it('recovers useful rows from messy generic OCR without Gemini', () => {
    const extraction = parseReceiptText(
      `
      TESCO EXPRESS
      VAT NO 123456789
      12/05/26 18:24
      12345 STRAWBERRIES
      £2.50
      BANANAS 2 @ 0.65 1.30 T
      OAT MILK 3 x 1.O0 3.O0
      SUB-TOTAL £6.80
      TOTAL GBP 6.80
      VISA 6.80
      `,
      { defaultCurrency: 'GBP' },
    )

    expect(extraction.merchant).toBe('Tesco Express')
    expect(extraction.items.map((item) => item.name)).toEqual([
      'Strawberries',
      'Bananas',
      'Oat Milk',
    ])
    expect(extraction.items[1]).toMatchObject({
      quantity: 2,
      unitPrice: 0.65,
      totalPrice: 1.3,
    })
    expect(extraction.items[2]).toMatchObject({
      quantity: 3,
      unitPrice: 1,
      totalPrice: 3,
    })
    expect(extraction.total).toBe(6.8)
  })

  it('infers likely store and item names from OCR noise without hardcoded typo mappings', () => {
    const extraction = parseReceiptText(
      `
      ALDT
      Oang 1.20
      lce 2.50
      TOTAL 3.70
      `,
      { defaultCurrency: 'GBP' },
    )

    expect(extraction.merchant).toBe('Aldi')
    expect(extraction.items.map((item) => item.name)).toEqual(['Orange', 'Rice'])
    expect(extraction.warnings).toContain('Inferred store name "Aldi" from OCR text "Aldt".')
  })

  it('uses app-provided date and local currency defaults when OCR does not provide them', () => {
    const extraction = parseReceiptText('Corner Shop\nCoffee 2.80\nTotal 2.80', {
      defaultCurrency: 'USD',
      defaultPurchasedAt: '2026-06-06',
    })

    expect(extraction.purchasedAt).toBe('2026-06-06')
    expect(extraction.currency).toBe('USD')
    expect(extraction.items[0].currency).toBe('USD')
  })

  it('keeps product-size modifiers out of the price when parsing supermarket rows', () => {
    const extraction = parseReceiptText('ALDI STORES\n306030 EE SPAGHETTI 5006      0.56 A', {
      defaultCurrency: 'GBP',
    })

    expect(extraction.items[0]).toMatchObject({
      name: 'Ee Spaghetti 500G',
      quantity: 1,
      totalPrice: 0.56,
    })
  })

  it('keeps open-ended product names while rejecting OCR fragment rows', () => {
    const extraction = parseReceiptText(
      `
      Market
      Yi Li Yo la Tan 0.89
      Pink Lady Apples 6PK 2.40
      TOTAL 2.40
      `,
      { defaultCurrency: 'GBP' },
    )

    expect(extraction.items.map((item) => item.name)).toEqual(['Pink Lady Apples 6PK'])
  })

  it('repairs item modifiers glued to prices after OCR', () => {
    const extraction = parseReceiptText(
      `
      ALDI STORES
      2 X 1.45
      508678 PROTEIN PAICAKES 42,90 A
      TOTAL 2.90
      `,
      { defaultCurrency: 'GBP' },
    )

    expect(extraction.items[0]).toMatchObject({
      name: 'Protein Pancakes 4',
      quantity: 2,
      unitPrice: 1.45,
      totalPrice: 2.9,
    })
  })

  it('detects receipt totals when OCR spaces the label letters apart', () => {
    const extraction = parseReceiptText(
      `
      ALDI STORES
      BREAD WHT TOASTIE 0.75
      T o t a l 29.47
      `,
      { defaultCurrency: 'GBP' },
    )

    expect(extraction.total).toBe(29.47)
    expect(extraction.items.some((item) => /total/i.test(item.name))).toBe(false)
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

describe('sheet and CSV exports', () => {
  it('builds one Google Sheet row per receipt item', () => {
    const extraction = parseReceiptText('Grocer\nTea £3.25\nCake £2.75\nTotal £6.00', {
      defaultCurrency: 'GBP',
    })
    const rows = buildSheetRows(extraction, '2026-06-06T10:00:00.000Z')

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      capturedAt: '2026-06-06T10:00:00.000Z',
      merchant: 'Aldi',
      itemName: 'Tea',
      totalPrice: 3.25,
      receiptTotal: 6,
    })
  })

  it('adds a dated separator before each Google Sheet receipt append', () => {
    const extraction = parseReceiptText('Grocer\nTea £3.25\nCake £2.75\nTotal £6.00', {
      defaultCurrency: 'GBP',
      defaultPurchasedAt: '2026-06-06',
    })

    const values = buildReceiptAppendValues(extraction, '2026-06-06T10:00:00.000Z')

    expect(values[0]).toEqual(['', '', '', '', '', '', '', '', '', ''])
    expect(values[1]).toEqual([
      'New receipt - 2026-06-06',
      '2026-06-06T10:00:00.000Z',
      'Aldi',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ])
    expect(values.slice(2)).toHaveLength(2)
  })

  it('escapes cell content in the CSV export', () => {
    const extraction = parseReceiptText('Shop\nMilk <large> £1.95\nTotal £1.95', {
      defaultCurrency: 'GBP',
    })
    const csv = createReceiptCsv({ ...extraction, merchant: 'A&B "Shop"' })

    expect(csv).toContain('"A&B ""Shop"""')
    expect(csv).toContain('Milk')
    expect(csv).not.toContain('data:image')
  })

  it('extracts spreadsheet IDs from normal Google Sheet links', () => {
    expect(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/sheet-id_123/edit')).toBe(
      'sheet-id_123',
    )
  })
})
