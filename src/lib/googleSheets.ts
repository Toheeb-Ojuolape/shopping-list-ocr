import type { ReceiptExtraction, ReceiptItem } from './receipt'
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
  imageDataUrl: string
  rawText: string
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
    rawText: string
    imageDataUrl?: string
  }
  rows: SheetRow[]
}

export function buildSheetRows(
  extraction: ReceiptExtraction,
  imageDataUrl = '',
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
    imageDataUrl,
    rawText: extraction.rawText,
  }))
}

export function buildSheetPayload(
  settings: Pick<SheetSettings, 'sheetName'>,
  extraction: ReceiptExtraction,
  imageDataUrl?: string,
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
      rawText: extraction.rawText,
      imageDataUrl,
    },
    rows: buildSheetRows(extraction, imageDataUrl),
  }
}

export async function appendReceiptToGoogleSheet(
  settings: SheetSettings,
  extraction: ReceiptExtraction,
  imageDataUrl?: string,
): Promise<void> {
  const endpointUrl = settings.endpointUrl.trim()
  if (!endpointUrl) {
    throw new Error('Add a Google Apps Script web app URL before saving.')
  }

  const response = await fetch(endpointUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify(buildSheetPayload(settings, extraction, imageDataUrl)),
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
      'Unit Price', 'Line Total', 'Currency', 'Receipt Total', 'Image Data URL', 'Raw OCR Text'
    ]);
  }

  payload.rows.forEach((row) => {
    sheet.appendRow([
      row.receiptId, row.capturedAt, row.merchant, row.purchasedAt, row.itemName,
      row.quantity, row.unitPrice, row.totalPrice, row.currency, row.receiptTotal,
      row.imageDataUrl, row.rawText
    ]);
  });

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, rows: payload.rows.length }))
    .setMimeType(ContentService.MimeType.JSON);
}`
}

export function createExcelHtml(extraction: ReceiptExtraction, imageDataUrl?: string): string {
  const lineTotal = sumItems(extraction.items)
  const rows = extraction.items.map((item) => createExcelItemRow(item)).join('')
  const image = imageDataUrl
    ? `<tr><td colspan="5"><img src="${escapeHtml(imageDataUrl)}" style="max-width:360px;width:100%;height:auto;" /></td></tr>`
    : ''

  return `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body>
<table>
<tr><th colspan="5">Receipt</th></tr>
${image}
<tr><td>Merchant</td><td colspan="4">${escapeHtml(extraction.merchant)}</td></tr>
<tr><td>Purchased At</td><td colspan="4">${escapeHtml(extraction.purchasedAt ?? '')}</td></tr>
<tr><td>Receipt ID</td><td colspan="4">${escapeHtml(extraction.receiptId)}</td></tr>
<tr><td>Line Total</td><td colspan="4">${lineTotal}</td></tr>
<tr><td>Receipt Total</td><td colspan="4">${extraction.total ?? ''}</td></tr>
<tr></tr>
<tr><th>Item</th><th>Quantity</th><th>Unit Price</th><th>Line Total</th><th>Currency</th></tr>
${rows}
</table>
</body>
</html>`
}

export function downloadExcelWorkbook(extraction: ReceiptExtraction, imageDataUrl?: string): void {
  const html = createExcelHtml(extraction, imageDataUrl)
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${extraction.receiptId}.xls`
  anchor.click()
  URL.revokeObjectURL(url)
}

function createExcelItemRow(item: ReceiptItem): string {
  return `<tr><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${item.unitPrice ?? ''}</td><td>${item.totalPrice}</td><td>${item.currency}</td></tr>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
