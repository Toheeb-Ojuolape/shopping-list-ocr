import type { CurrencyCode } from './receipt'

export const brandColor = '#ff6561'

export type SavedSheetSettings = {
  endpointUrl: string
  sheetName: string
}

export function getEnvGeminiKey(): string {
  if (import.meta.env.MODE === 'test' || import.meta.env.VITE_TEST_OCR_TEXT) {
    return ''
  }

  return import.meta.env.VITE_GEMINI_API_KEY ?? ''
}

export function getSavedSheetSettings(): SavedSheetSettings {
  return {
    endpointUrl: localStorage.getItem('receipt-sheet-endpoint') ?? '',
    sheetName: localStorage.getItem('receipt-sheet-name') ?? 'Receipts',
  }
}

export function saveSheetSettings(settings: SavedSheetSettings): void {
  localStorage.setItem('receipt-sheet-endpoint', settings.endpointUrl)
  localStorage.setItem('receipt-sheet-name', settings.sheetName)
}

export function toReadableStatus(status: string): string {
  const readable = status.replace(/_/g, ' ').trim()
  return readable.charAt(0).toUpperCase() + readable.slice(1)
}

export function toPositiveNumber(value: string | number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? roundNumber(parsed) : fallback
}

export function roundNumber(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function formatMoney(value: number, currency: CurrencyCode): string {
  if (currency === 'UNKNOWN') {
    return value.toFixed(2)
  }

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(value)
}
