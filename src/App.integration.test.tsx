import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { refineReceiptWithGemini } from './lib/gemini'
import { appendReceiptToGoogleSheet, downloadExcelWorkbook } from './lib/googleSheets'
import { recognizeReceiptImage } from './lib/ocr'

const receiptOcrText = `
FRESH MART
04/19/2026
BANANAS £1.25
OAT MILK £4.50
TOTAL £5.75
`

vi.mock('./lib/ocr', () => ({
  recognizeReceiptImage: vi.fn(),
}))

vi.mock('./lib/gemini', () => ({
  refineReceiptWithGemini: vi.fn(),
}))

vi.mock('./lib/googleSheets', () => ({
  appendReceiptToGoogleSheet: vi.fn(),
  createAppsScriptTemplate: vi.fn(() => 'function doPost(event) { return event; }'),
  downloadExcelWorkbook: vi.fn(),
}))

const recognizeReceiptImageMock = vi.mocked(recognizeReceiptImage)
const refineReceiptWithGeminiMock = vi.mocked(refineReceiptWithGemini)
const appendReceiptToGoogleSheetMock = vi.mocked(appendReceiptToGoogleSheet)
const downloadExcelWorkbookMock = vi.mocked(downloadExcelWorkbook)

describe('App integration', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    recognizeReceiptImageMock.mockResolvedValue({ text: receiptOcrText, confidence: 98 })
    refineReceiptWithGeminiMock.mockImplementation(async (_apiKey, _rawText, fallback) => fallback)
    appendReceiptToGoogleSheetMock.mockResolvedValue(undefined)
    mockCamera()
  })

  it('uploads a receipt image, extracts editable rows, saves to Google Sheets, and downloads Excel', async () => {
    render(<App />)

    uploadReceiptImage()

    await screen.findByAltText('Captured receipt')
    fireEvent.click(screen.getByRole('button', { name: 'Extract' }))

    expect(await screen.findByText('2 rows ready')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Fresh Mart')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bananas')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Oat Milk')).toBeInTheDocument()
    expect(screen.getAllByText('£5.75')).toHaveLength(2)

    const firstRow = screen.getAllByTestId('item-row')[0]
    fireEvent.change(within(firstRow).getByLabelText('Item'), { target: { value: 'Organic Bananas' } })
    fireEvent.change(within(firstRow).getByLabelText('Price'), { target: { value: '1.50' } })

    fireEvent.change(screen.getByLabelText('Apps Script URL'), {
      target: { value: 'https://script.google.com/macros/s/test/exec' },
    })
    fireEvent.change(screen.getByLabelText('Sheet tab'), { target: { value: 'June Receipts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to Sheet' }))

    await waitFor(() => expect(appendReceiptToGoogleSheetMock).toHaveBeenCalledTimes(1))
    expect(appendReceiptToGoogleSheetMock).toHaveBeenCalledWith(
      {
        endpointUrl: 'https://script.google.com/macros/s/test/exec',
        sheetName: 'June Receipts',
      },
      expect.objectContaining({
        merchant: 'Fresh Mart',
        items: expect.arrayContaining([
          expect.objectContaining({ name: 'Organic Bananas', totalPrice: 1.5 }),
        ]),
      }),
      expect.stringContaining('data:image/png;base64'),
    )

    expect(await screen.findByText('Saved to Google Sheet')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Download XLS' }))
    expect(downloadExcelWorkbookMock).toHaveBeenCalledWith(
      expect.objectContaining({ merchant: 'Fresh Mart' }),
      expect.stringContaining('data:image/png;base64'),
    )
  })

  it('uses Gemini refinement when the user enables it and supplies a key', async () => {
    refineReceiptWithGeminiMock.mockImplementation(async (_apiKey, _rawText, fallback) => ({
      ...fallback,
      merchant: 'Gemini Market',
      items: [
        {
          id: 'gemini-row',
          name: 'Gemini Apples',
          quantity: 1,
          unitPrice: 3.25,
          totalPrice: 3.25,
          currency: 'GBP',
          confidence: 0.94,
        },
      ],
      total: 3.25,
    }))

    render(<App />)

    const geminiToggle = screen.getByLabelText('Gemini refine') as HTMLInputElement
    if (!geminiToggle.checked) {
      fireEvent.click(geminiToggle)
    }
    fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'test-key' } })
    uploadReceiptImage()
    await screen.findByAltText('Captured receipt')

    fireEvent.click(screen.getByRole('button', { name: 'Extract' }))

    expect(await screen.findByText('1 rows ready')).toBeInTheDocument()
    expect(refineReceiptWithGeminiMock).toHaveBeenCalledWith(
      'test-key',
      receiptOcrText,
      expect.objectContaining({ merchant: 'Fresh Mart' }),
    )
    expect(screen.getByDisplayValue('Gemini Market')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Gemini Apples')).toBeInTheDocument()
  })

  it('shows a useful error when saving without a Google Sheets endpoint', async () => {
    appendReceiptToGoogleSheetMock.mockRejectedValue(new Error('Add a Google Apps Script web app URL before saving.'))

    render(<App />)

    uploadReceiptImage()
    await screen.findByAltText('Captured receipt')
    fireEvent.click(screen.getByRole('button', { name: 'Extract' }))
    await screen.findByText('2 rows ready')
    fireEvent.click(screen.getByRole('button', { name: 'Save to Sheet' }))

    expect(await screen.findByText('Add a Google Apps Script web app URL before saving.')).toBeInTheDocument()
  })
})

function uploadReceiptImage() {
  const file = new File(['receipt'], 'receipt.png', { type: 'image/png' })
  fireEvent.change(screen.getByTestId('receipt-upload'), { target: { files: [file] } })
}

function mockCamera() {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
    },
  })
}
