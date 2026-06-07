import type { ReceiptExtraction } from './receipt'
import { uploadReceiptImageToDrive } from './googleDrive'
import { sumItems } from './receipt'

export type SheetSettings = {
  sheetUrl: string
  sheetName: string
  accessToken: string
}

export type AppendReceiptResult = {
  imageUrl?: string
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
  image: string
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

type SheetMetadata = {
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>
}

type AddSheetResponse = {
  replies?: Array<{ addSheet?: { properties?: { sheetId?: number } } }>
}

type AppendValuesResponse = {
  updates?: {
    updatedRange?: string
  }
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
  'Image',
]

const sheetColumnCount = sheetHeaders.length

export function buildSheetRows(
  extraction: ReceiptExtraction,
  capturedAt = new Date().toISOString(),
): SheetRow[] {
  const receiptTotal = extraction.total ?? sumItems(extraction.items)
  const image = getSheetImageValue(extraction)

  return extraction.items.map((item, index) => ({
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
    image: index === 0 ? image : '',
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
): Promise<AppendReceiptResult> {
  const spreadsheetId = parseSpreadsheetId(settings.sheetUrl)
  const sheetName = settings.sheetName.trim() || 'Receipts'
  const accessToken = settings.accessToken.trim()

  if (!accessToken) {
    throw new Error('Connect Google before saving.')
  }

  const uploadedImage =
    extraction.imageUrl || !extraction.imageDataUri
      ? undefined
      : await uploadReceiptImageToDrive(accessToken, extraction)
  const extractionForSheet = {
    ...extraction,
    imageUrl: extraction.imageUrl ?? uploadedImage?.imageUrl,
  }

  const sheetId = await ensureSheetExists(spreadsheetId, sheetName, accessToken)
  await ensureHeaderRow(spreadsheetId, sheetName, accessToken)
  const appendResponse = await appendValues(
    spreadsheetId,
    sheetName,
    buildReceiptAppendValues(extractionForSheet),
    accessToken,
  )
  await formatReceiptImageCell(
    spreadsheetId,
    sheetId,
    appendResponse,
    extractionForSheet,
    accessToken,
  )

  return { imageUrl: extractionForSheet.imageUrl }
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
    row.image,
  ]
}

export function buildReceiptAppendValues(
  extraction: ReceiptExtraction,
  capturedAt = new Date().toISOString(),
): Array<Array<string | number>> {
  const savedDate = capturedAt.slice(0, 10)

  return [
    Array.from({ length: sheetColumnCount }, () => ''),
    ['New receipt - ' + savedDate, capturedAt, extraction.merchant, '', '', '', '', '', '', '', ''],
    ...buildSheetRows(extraction, capturedAt).map(sheetRowToValues),
  ]
}

export function createReceiptCsv(extraction: ReceiptExtraction): string {
  const headers = sheetHeaders.filter((header) => header !== 'Captured At')
  const imageUrl = extraction.imageUrl ?? ''

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
    row.image ? imageUrl : '',
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
): Promise<number> {
  const metadata = await fetchJson<SheetMetadata>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
    accessToken,
  )

  const existingSheet = metadata.sheets?.find((sheet) => sheet.properties?.title === sheetName)
  if (typeof existingSheet?.properties?.sheetId === 'number') {
    return existingSheet.properties.sheetId
  }

  const createdSheet = await fetchJson<AddSheetResponse>(
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

  const sheetId = createdSheet.replies?.[0]?.addSheet?.properties?.sheetId
  if (typeof sheetId !== 'number') {
    throw new Error('Google created the Sheet tab but did not return its ID.')
  }

  return sheetId
}

async function ensureHeaderRow(
  spreadsheetId: string,
  sheetName: string,
  accessToken: string,
): Promise<void> {
  const firstRow = await fetchJson<{ values?: string[][] }>(
    sheetApiUrl(spreadsheetId, `${quoteSheetName(sheetName)}!A1:K1`),
    accessToken,
  )

  if (firstRow.values?.[0]?.[sheetColumnCount - 1] === 'Image') {
    return
  }

  if (firstRow.values?.[0]?.length) {
    await updateValues(
      spreadsheetId,
      `${quoteSheetName(sheetName)}!A1:K1`,
      [sheetHeaders],
      accessToken,
    )
    return
  }

  await appendValues(spreadsheetId, sheetName, [sheetHeaders], accessToken)
}

async function appendValues(
  spreadsheetId: string,
  sheetName: string,
  values: Array<Array<string | number>>,
  accessToken: string,
): Promise<AppendValuesResponse> {
  if (!values.length) {
    return {}
  }

  return fetchJson<AppendValuesResponse>(
    `${sheetApiUrl(spreadsheetId, `${quoteSheetName(sheetName)}!A:K`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`,
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

async function updateValues(
  spreadsheetId: string,
  range: string,
  values: Array<Array<string | number>>,
  accessToken: string,
): Promise<void> {
  await fetchJson(
    `${sheetApiUrl(spreadsheetId, range)}?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({
        majorDimension: 'ROWS',
        values,
      }),
    },
  )
}

async function formatReceiptImageCell(
  spreadsheetId: string,
  sheetId: number,
  appendResponse: AppendValuesResponse,
  extraction: ReceiptExtraction,
  accessToken: string,
): Promise<void> {
  if (!extraction.imageUrl) {
    return
  }

  const appendedStartRow = parseStartRowFromRange(appendResponse.updates?.updatedRange)
  if (!appendedStartRow) {
    return
  }

  const itemStartRowIndex = appendedStartRow + 1
  const itemEndRowIndex = itemStartRowIndex + extraction.items.length
  const imageColumnIndex = sheetColumnCount - 1

  const requests: Array<Record<string, unknown>> = [
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: imageColumnIndex,
          endIndex: imageColumnIndex + 1,
        },
        properties: {
          pixelSize: 260,
        },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: itemStartRowIndex,
          endIndex: itemEndRowIndex,
        },
        properties: {
          pixelSize: extraction.items.length === 1 ? 180 : 56,
        },
        fields: 'pixelSize',
      },
    },
  ]

  if (extraction.items.length > 1) {
    requests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: itemStartRowIndex,
          endRowIndex: itemEndRowIndex,
          startColumnIndex: imageColumnIndex,
          endColumnIndex: imageColumnIndex + 1,
        },
        mergeType: 'MERGE_ALL',
      },
    })
  }

  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: itemStartRowIndex,
        endRowIndex: itemEndRowIndex,
        startColumnIndex: imageColumnIndex,
        endColumnIndex: imageColumnIndex + 1,
      },
      cell: {
        userEnteredFormat: {
          verticalAlignment: 'MIDDLE',
          horizontalAlignment: 'CENTER',
          wrapStrategy: 'CLIP',
        },
      },
      fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)',
    },
  })

  await fetchJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests,
      }),
    },
  )
}

function getSheetImageValue(extraction: ReceiptExtraction): string {
  if (!extraction.imageUrl) {
    return ''
  }

  return `=IMAGE("${escapeSheetFormulaString(extraction.imageUrl)}", 1)`
}

function escapeSheetFormulaString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function parseStartRowFromRange(range: string | undefined): number | undefined {
  const match = range?.match(/![A-Z]+(\d+):/i)
  if (!match) {
    return undefined
  }

  return Number(match[1])
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
