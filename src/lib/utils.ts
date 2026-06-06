import type { CurrencyCode } from './receipt'
import toast from 'react-hot-toast'

export const brandColor = '#ff6561'

export type SavedSheetSettings = {
  sheetUrl: string
  sheetName: string
}

export function getEnvGeminiKey(): string {
  if (import.meta.env.MODE === 'test' || import.meta.env.VITE_TEST_OCR_TEXT) {
    return ''
  }

  return import.meta.env.VITE_GEMINI_API_KEY ?? ''
}

export function getEnvGoogleClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
}

export function getSavedSheetSettings(): SavedSheetSettings {
  return {
    sheetUrl:
      localStorage.getItem('receipt-sheet-url') ??
      localStorage.getItem('receipt-sheet-endpoint') ??
      '',
    sheetName: localStorage.getItem('receipt-sheet-name') ?? 'Receipts',
  }
}

export function saveSheetSettings(settings: SavedSheetSettings): void {
  localStorage.setItem('receipt-sheet-url', settings.sheetUrl)
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

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(value)
  } catch {
    return value.toFixed(2)
  }
}

export const handleSuccess = (message: string) => {
  toast.success(message, {
    duration: 4000,
    style: {
      fontWeight: 'medium',
    },
  })
}

export const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Please try again later.'

type ErrorWithResponse = {
  response?: {
    data?: {
      error?: string | { error?: string }
    }
  }
}

export function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object') {
    const responseError = (error as ErrorWithResponse).response?.data?.error
    if (typeof responseError === 'string') {
      return responseError
    }

    if (typeof responseError?.error === 'string') {
      return responseError.error
    }

    if (error instanceof Error && error.message) {
      return error.message
    }
  }

  return DEFAULT_ERROR_MESSAGE
}

export const handleError = (error: unknown) => {
  toast.error(getErrorMessage(error), {
    duration: 5000,
    style: {
      fontWeight: 'medium',
    },
  })
}

type ToastMessage<T> = string | ((value: T) => string)

export function withToast<T>(
  action: () => Promise<T>,
  messages: {
    loading: string
    success: ToastMessage<T>
    error?: ToastMessage<unknown>
  },
): Promise<T> {
  return toast.promise(action(), {
    loading: messages.loading,
    success: messages.success,
    error: messages.error ?? getErrorMessage,
  })
}

export function getTodayIsoDate(date = new Date()): string {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return offsetDate.toISOString().slice(0, 10)
}

export const today = getTodayIsoDate()
