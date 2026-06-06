import type { CurrencyCode, ReceiptExtraction, ReceiptItem } from './receipt'
import { parseReceiptText, roundMoney, sumItems } from './receipt'

type GeminiReceiptPayload = {
  merchant?: string
  purchasedAt?: string
  currency?: CurrencyCode
  subtotal?: number
  tax?: number
  total?: number
  items?: Array<{
    name?: string
    quantity?: number
    unitPrice?: number
    totalPrice?: number
  }>
}

export async function refineReceiptWithGemini(
  apiKey: string,
  rawText: string,
  fallback: ReceiptExtraction,
): Promise<ReceiptExtraction> {
  const trimmedKey = apiKey.trim()
  if (!trimmedKey) {
    return fallback
  }

  const { GoogleGenAI } = await import('@google/genai')
  const ai = new GoogleGenAI({ apiKey: trimmedKey })
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: buildReceiptPrompt(rawText, fallback),
  })

  const payload = parseGeminiJson(response.text ?? '')
  if (!payload) {
    return fallback
  }

  return mergeGeminiPayload(payload, fallback, rawText)
}

export function mergeGeminiPayload(
  payload: GeminiReceiptPayload,
  fallback: ReceiptExtraction,
  rawText = fallback.rawText,
): ReceiptExtraction {
  const parsedFallback = rawText === fallback.rawText ? fallback : parseReceiptText(rawText)
  const currency = normalizeCurrency(payload.currency) ?? parsedFallback.currency
  const items = normalizeGeminiItems(payload.items, currency)

  return {
    ...parsedFallback,
    merchant: cleanText(payload.merchant) || parsedFallback.merchant,
    purchasedAt: cleanText(payload.purchasedAt) || parsedFallback.purchasedAt,
    currency,
    subtotal: safeMoney(payload.subtotal) ?? parsedFallback.subtotal,
    tax: safeMoney(payload.tax) ?? parsedFallback.tax,
    total: safeMoney(payload.total) ?? (items.length ? sumItems(items) : parsedFallback.total),
    items: items.length ? items : parsedFallback.items,
    rawText,
    warnings: parsedFallback.warnings,
  }
}

function buildReceiptPrompt(rawText: string, fallback: ReceiptExtraction): string {
  return `Extract structured receipt data from this OCR text. Return only valid JSON with this shape:
{
  "merchant": "string",
  "purchasedAt": "YYYY-MM-DD if visible",
  "currency": "GBP or USD or EUR or UNKNOWN",
  "subtotal": number,
  "tax": number,
  "total": number,
  "items": [{"name":"string","quantity":number,"unitPrice":number,"totalPrice":number}]
}

Rules:
- Include only actual purchased products or services.
- Exclude totals, taxes, payment rows, card rows, discounts unless the discount is a line item.
- Use the visible item line total as totalPrice.
- Prefer the OCR text, but use this fallback parse to resolve ambiguity:
${JSON.stringify(fallback)}

OCR text:
${rawText}`
}

function parseGeminiJson(text: string): GeminiReceiptPayload | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) {
    return undefined
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as GeminiReceiptPayload
  } catch {
    return undefined
  }
}

function normalizeGeminiItems(
  items: GeminiReceiptPayload['items'],
  currency: CurrencyCode,
): ReceiptItem[] {
  if (!Array.isArray(items)) {
    return []
  }

  return items.reduce<ReceiptItem[]>((normalizedItems, item, index) => {
    const name = cleanText(item.name)
    const totalPrice = safeMoney(item.totalPrice)
    if (!name || totalPrice === undefined) {
      return normalizedItems
    }

    const quantity =
      Number.isFinite(item.quantity) && Number(item.quantity) > 0 ? Number(item.quantity) : 1
    const unitPrice = safeMoney(item.unitPrice) ?? roundMoney(totalPrice / quantity)

    normalizedItems.push({
      id: `gemini-${index + 1}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      quantity,
      unitPrice,
      totalPrice,
      currency,
      confidence: 0.92,
    })

    return normalizedItems
  }, [])
}

function normalizeCurrency(currency: unknown): CurrencyCode | undefined {
  if (currency === 'GBP' || currency === 'USD' || currency === 'EUR' || currency === 'UNKNOWN') {
    return currency
  }

  return undefined
}

function safeMoney(value: unknown): number | undefined {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? roundMoney(numberValue) : undefined
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const cleaned = value.trim().replace(/\s+/g, ' ')
  return cleaned || undefined
}
