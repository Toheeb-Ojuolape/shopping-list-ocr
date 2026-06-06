export type CurrencyCode = 'GBP' | 'USD' | 'EUR' | 'UNKNOWN'

export type ReceiptItem = {
  id: string
  name: string
  quantity: number
  unitPrice?: number
  totalPrice: number
  currency: CurrencyCode
  confidence: number
  sourceLine?: string
}

export type ReceiptExtraction = {
  receiptId: string
  merchant: string
  purchasedAt?: string
  currency: CurrencyCode
  subtotal?: number
  tax?: number
  total?: number
  items: ReceiptItem[]
  rawText: string
  warnings: string[]
}

export type ParseReceiptOptions = {
  defaultCurrency?: CurrencyCode
}

type MoneyMatch = {
  token: string
  value: number
  currency?: CurrencyCode
  index: number
}

const currencyBySymbol: Record<string, CurrencyCode> = {
  '£': 'GBP',
  '$': 'USD',
  '€': 'EUR',
}

const totalLabels = /\b(total|amount due|balance due)\b/i
const subtotalLabels = /\b(subtotal|sub total|sub-total)\b/i
const taxLabels = /\b(tax|vat|gst|hst)\b/i
const nonItemLabels =
  /\b(receipt|invoice|cash|card|visa|mastercard|amex|change|payment|auth|terminal|merchant id|thank|served by|operator|balance|refund|approved)\b/i

export function parseReceiptText(
  rawText: string,
  options: ParseReceiptOptions = {},
): ReceiptExtraction {
  const lines = normalizeReceiptText(rawText)
  const warnings: string[] = []
  const defaultCurrency = options.defaultCurrency ?? 'UNKNOWN'
  const merchant = detectMerchant(lines)
  const purchasedAt = detectDate(rawText)
  const receiptId = createReceiptId(rawText)

  let subtotal: number | undefined
  let tax: number | undefined
  let total: number | undefined
  let currency: CurrencyCode = defaultCurrency

  const items: ReceiptItem[] = []

  lines.forEach((line) => {
    const moneyMatches = extractMoneyMatches(line)
    const detectedCurrency = moneyMatches.find((match) => match.currency)?.currency
    if (detectedCurrency) {
      currency = detectedCurrency
    }

    if (moneyMatches.length === 0) {
      return
    }

    const lastValue = moneyMatches[moneyMatches.length - 1].value
    if (subtotalLabels.test(line)) {
      subtotal = lastValue
      return
    }

    if (taxLabels.test(line)) {
      tax = lastValue
      return
    }

    if (totalLabels.test(line) && !subtotalLabels.test(line)) {
      total = lastValue
      return
    }

    const item = parseItemLine(line, moneyMatches, items.length, detectedCurrency ?? currency)
    if (item) {
      items.push(item)
    }
  })

  const inferredCurrency = currency === 'UNKNOWN' ? defaultCurrency : currency
  const normalizedItems = items.map((item) => ({
    ...item,
    currency: item.currency === 'UNKNOWN' ? inferredCurrency : item.currency,
  }))

  if (normalizedItems.length === 0 && rawText.trim()) {
    warnings.push('No confident item rows were found. Edit the rows manually or retry with a flatter photo.')
  }

  if (total === undefined && normalizedItems.length > 0) {
    total = roundMoney(sumItems(normalizedItems))
  }

  return {
    receiptId,
    merchant,
    purchasedAt,
    currency: inferredCurrency,
    subtotal,
    tax,
    total,
    items: normalizedItems,
    rawText,
    warnings,
  }
}

export function normalizeReceiptText(rawText: string): string[] {
  return rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/[|]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/[“”]/g, '"')
        .trim(),
    )
    .filter(Boolean)
}

export function sumItems(items: Pick<ReceiptItem, 'totalPrice'>[]): number {
  return roundMoney(items.reduce((total, item) => total + safeNumber(item.totalPrice), 0))
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function parseItemLine(
  line: string,
  moneyMatches: MoneyMatch[],
  index: number,
  currency: CurrencyCode,
): ReceiptItem | undefined {
  if (nonItemLabels.test(line)) {
    return undefined
  }

  const totalMatch = moneyMatches[moneyMatches.length - 1]
  if (!totalMatch || totalMatch.value <= 0) {
    return undefined
  }

  let name = line.slice(0, totalMatch.index).trim()
  name = name.replace(/\b\d{8,14}\b/g, '').replace(/\s+/g, ' ').trim()
  name = name.replace(/\s+[-.:]$/, '').trim()

  if (!name || name.length < 2 || /^[\d\s.,$£€-]+$/.test(name)) {
    return undefined
  }

  const quantity = detectQuantity(name)
  name = name
    .replace(/^\d+(?:[.,]\d+)?\s*[xX]\s*/, '')
    .replace(/^\d+(?:[.,]\d+)?\s+@\s*/, '')
    .replace(/\s+@\s*\d+(?:[.,]\d{2})?$/g, '')
    .trim()

  const unitPrice =
    quantity > 1 ? roundMoney(totalMatch.value / quantity) : moneyMatches.length > 1 ? moneyMatches[0].value : undefined

  return {
    id: `${index + 1}-${slugify(name)}`,
    name: toTitleCase(name),
    quantity,
    unitPrice,
    totalPrice: totalMatch.value,
    currency,
    confidence: scoreItemConfidence(name, line),
    sourceLine: line,
  }
}

function extractMoneyMatches(line: string): MoneyMatch[] {
  const matches: MoneyMatch[] = []
  const moneyPattern = /([$£€])?\s*(-?\d{1,5}(?:[.,]\d{2}))(?!\d)/g
  let match: RegExpExecArray | null

  while ((match = moneyPattern.exec(line)) !== null) {
    const value = parseMoneyValue(match[2])
    if (Number.isFinite(value)) {
      matches.push({
        token: match[0],
        value,
        currency: match[1] ? currencyBySymbol[match[1]] : undefined,
        index: match.index,
      })
    }
  }

  return matches
}

function parseMoneyValue(token: string): number {
  return roundMoney(Number(token.replace(',', '.')))
}

function detectMerchant(lines: string[]): string {
  const merchantLine =
    lines.find((line) => !extractMoneyMatches(line).length && !nonItemLabels.test(line) && line.length > 2) ?? 'Unknown merchant'

  return toTitleCase(merchantLine.slice(0, 42))
}

function detectDate(rawText: string): string | undefined {
  const isoDate = rawText.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
  if (isoDate) {
    return `${isoDate[1]}-${padDatePart(isoDate[2])}-${padDatePart(isoDate[3])}`
  }

  const slashDate = rawText.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2}|\d{2})\b/)
  if (!slashDate) {
    return undefined
  }

  const first = Number(slashDate[1])
  const second = Number(slashDate[2])
  const year = slashDate[3].length === 2 ? `20${slashDate[3]}` : slashDate[3]
  const month = first > 12 ? second : first
  const day = first > 12 ? first : second

  return `${year}-${padDatePart(String(month))}-${padDatePart(String(day))}`
}

function detectQuantity(name: string): number {
  const explicitQuantity = name.match(/^(\d+(?:[.,]\d+)?)\s*[xX]\b/)
  if (explicitQuantity) {
    return Number(explicitQuantity[1].replace(',', '.'))
  }

  const atQuantity = name.match(/^(\d+(?:[.,]\d+)?)\s+@/)
  if (atQuantity) {
    return Number(atQuantity[1].replace(',', '.'))
  }

  return 1
}

function createReceiptId(rawText: string): string {
  let hash = 0
  for (const char of rawText) {
    hash = (hash << 5) - hash + char.charCodeAt(0)
    hash |= 0
  }

  return `receipt-${Math.abs(hash).toString(36)}`
}

function scoreItemConfidence(name: string, line: string): number {
  let score = 0.78
  if (name.length > 4) score += 0.08
  if (/[a-z]/i.test(name) && /\d+[.,]\d{2}/.test(line)) score += 0.08
  if (/[^a-z0-9\s&'./-]/i.test(name)) score -= 0.14
  return Math.max(0.35, Math.min(0.96, roundMoney(score)))
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
    .replace(/\bUk\b/g, 'UK')
    .replace(/\bUsa\b/g, 'USA')
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item'
}

function padDatePart(value: string): string {
  return value.padStart(2, '0')
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}
