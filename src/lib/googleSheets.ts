import type { ReceiptExtraction } from './receipt'
import { sumItems } from './receipt'

export type SheetSettings = {
  endpointUrl: string
  sheetName: string
}

export type SheetRow = {
  receiptId: string
  capturedAt: string
  merchant: string
  purchasedAt: string
  itemName: string
  quantity: number
  unitPrice: number | ''
  totalPrice: number
  currency: string
  receiptTotal: number | ''
}

export type SheetPayload = {
  sheetName: string
  receipt: {
    receiptId: string
    merchant: string
    purchasedAt?: string
    subtotal?: number
    tax?: number
    total?: number
    currency: string
  }
  rows: SheetRow[]
}

export function buildSheetRows(
  extraction: ReceiptExtraction,
  capturedAt = new Date().toISOString(),
): SheetRow[] {
  const receiptTotal = extraction.total ?? sumItems(extraction.items)

  return extraction.items.map((item) => ({
    receiptId: extraction.receiptId,
    capturedAt,
    merchant: extraction.merchant,
    purchasedAt: extraction.purchasedAt ?? '',
    itemName: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice ?? '',
    totalPrice: item.totalPrice,
    currency: item.currency,
    receiptTotal,
  }))
}

export function buildSheetPayload(
  settings: Pick<SheetSettings, 'sheetName'>,
  extraction: ReceiptExtraction,
): SheetPayload {
  return {
    sheetName: settings.sheetName.trim() || 'Receipts',
    receipt: {
      receiptId: extraction.receiptId,
      merchant: extraction.merchant,
      purchasedAt: extraction.purchasedAt,
      subtotal: extraction.subtotal,
      tax: extraction.tax,
      total: extraction.total,
      currency: extraction.currency,
    },
    rows: buildSheetRows(extraction),
  }
}

export async function appendReceiptToGoogleSheet(
  settings: SheetSettings,
  extraction: ReceiptExtraction,
): Promise<void> {
  const endpointUrl = settings.endpointUrl.trim()
  if (!endpointUrl) {
    throw new Error('Add your Google Sheet link before saving.')
  }

  const response = await fetch(endpointUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify(buildSheetPayload(settings, extraction)),
  })

  if (response.type !== 'opaque' && !response.ok) {
    throw new Error(`Google Sheet save failed with HTTP ${response.status}.`)
  }
}

export function createAppsScriptTemplate(): string {
  return `const DEFAULT_SHEET = 'Receipts';

function doPost(event) {
  const payload = JSON.parse(event.postData.contents);
  const sheet = SpreadsheetApp.getActive().getSheetByName(payload.sheetName || DEFAULT_SHEET)
    || SpreadsheetApp.getActive().insertSheet(payload.sheetName || DEFAULT_SHEET);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Receipt ID', 'Captured At', 'Merchant', 'Purchased At', 'Item', 'Quantity',
      'Unit Price', 'Line Total', 'Currency', 'Receipt Total'
    ]);
  }

  payload.rows.forEach((row) => {
    sheet.appendRow([
      row.receiptId, row.capturedAt, row.merchant, row.purchasedAt, row.itemName,
      row.quantity, row.unitPrice, row.totalPrice, row.currency, row.receiptTotal
    ]);
  });

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, rows: payload.rows.length }))
    .setMimeType(ContentService.MimeType.JSON);
}`
}

export function createReceiptCsv(extraction: ReceiptExtraction): string {
  const headers = [
    'Receipt ID',
    'Merchant',
    'Purchased At',
    'Item',
    'Quantity',
    'Unit Price',
    'Line Total',
    'Currency',
    'Receipt Total',
  ]

  const rows = buildSheetRows(extraction).map((row) => [
    row.receiptId,
    row.merchant,
    row.purchasedAt,
    row.itemName,
    row.quantity,
    row.unitPrice,
    row.totalPrice,
    row.currency,
    row.receiptTotal,
  ])

  return [headers, ...rows].map((row) => row.map(formatCsvCell).join(',')).join('\n')
}

export function downloadReceiptCsv(extraction: ReceiptExtraction): void {
  const csv = createReceiptCsv(extraction)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${extraction.receiptId}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

function formatCsvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
