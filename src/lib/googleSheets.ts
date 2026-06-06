import type { ReceiptExtraction } from './receipt'
import { sumItems } from './receipt'

export type SheetSettings = {
  sheetUrl: string
  sheetName: string
  accessToken: string
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

const sheetHeaders = [
  'Receipt ID',
  'Captured At',
  'Merchant',
  'Purchased At',
  'Item',
  'Quantity',
  'Unit Price',
  'Line Total',
  'Currency',
  'Receipt Total',
]

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
  const spreadsheetId = parseSpreadsheetId(settings.sheetUrl)
  const sheetName = settings.sheetName.trim() || 'Receipts'
  const accessToken = settings.accessToken.trim()

  if (!accessToken) {
    throw new Error('Connect Google before saving.')
  }

  await ensureSheetExists(spreadsheetId, sheetName, accessToken)
  await ensureHeaderRow(spreadsheetId, sheetName, accessToken)
  await appendValues(
    spreadsheetId,
    sheetName,
    buildSheetRows(extraction).map(sheetRowToValues),
    accessToken,
  )
}

export function parseSpreadsheetId(sheetUrl: string): string {
  const trimmed = sheetUrl.trim()
  if (!trimmed) {
    throw new Error('Add your Google Sheet link before saving.')
  }

  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed) && !trimmed.includes('/')) {
    return trimmed
  }

  try {
    const url = new URL(trimmed)
    const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
    if (url.hostname === 'docs.google.com' && match?.[1]) {
      return match[1]
    }
  } catch {
    throw new Error('Use a valid Google Sheet link.')
  }

  throw new Error('Use a Google Sheet link from docs.google.com/spreadsheets.')
}

export function sheetRowToValues(row: SheetRow): Array<string | number> {
  return [
    row.receiptId,
    row.capturedAt,
    row.merchant,
    row.purchasedAt,
    row.itemName,
    row.quantity,
    row.unitPrice,
    row.totalPrice,
    row.currency,
    row.receiptTotal,
  ]
}

export function createReceiptCsv(extraction: ReceiptExtraction): string {
  const headers = sheetHeaders.filter((header) => header !== 'Captured At')

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

async function ensureSheetExists(
  spreadsheetId: string,
  sheetName: string,
  accessToken: string,
): Promise<void> {
  const metadata = await fetchJson<{ sheets?: Array<{ properties?: { title?: string } }> }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    accessToken,
  )

  const exists = metadata.sheets?.some((sheet) => sheet.properties?.title === sheetName)
  if (exists) {
    return
  }

  await fetchJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      }),
    },
  )
}

async function ensureHeaderRow(
  spreadsheetId: string,
  sheetName: string,
  accessToken: string,
): Promise<void> {
  const firstRow = await fetchJson<{ values?: string[][] }>(
    sheetApiUrl(spreadsheetId, `${quoteSheetName(sheetName)}!A1:J1`),
    accessToken,
  )

  if (firstRow.values?.[0]?.length) {
    return
  }

  await appendValues(spreadsheetId, sheetName, [sheetHeaders], accessToken)
}

async function appendValues(
  spreadsheetId: string,
  sheetName: string,
  values: Array<Array<string | number>>,
  accessToken: string,
): Promise<void> {
  if (!values.length) {
    return
  }

  await fetchJson(
    `${sheetApiUrl(spreadsheetId, `${quoteSheetName(sheetName)}!A:J`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        majorDimension: 'ROWS',
        values,
      }),
    },
  )
}

function sheetApiUrl(spreadsheetId: string, range: string): string {
  return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`
}

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`
}

async function fetchJson<T>(url: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const message = await readGoogleError(response)
    throw new Error(message)
  }

  return (await response.json()) as T
}

async function readGoogleError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    if (body.error?.message) {
      return body.error.message
    }
  } catch {
    // Fall through to status-based message.
  }

  if (response.status === 401 || response.status === 403) {
    return 'Google did not allow access to this Sheet. Reconnect Google or check sharing permissions.'
  }

  return `Google Sheet save failed with HTTP ${response.status}.`
}
