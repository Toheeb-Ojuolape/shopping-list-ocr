import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ReceiptCamera } from './components/ReceiptCamera'
import { requestGoogleSheetsAccessToken } from './lib/googleAuth'
import { appendReceiptToGoogleSheet, downloadReceiptCsv } from './lib/googleSheets'
import { recognizeReceiptImage } from './lib/ocr'
import { theme } from './theme'

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

vi.mock('./lib/googleSheets', () => ({
  appendReceiptToGoogleSheet: vi.fn(),
  downloadReceiptCsv: vi.fn(),
}))

vi.mock('./lib/googleAuth', () => ({
  getCachedGoogleSheetsAccessToken: vi.fn(() => ''),
  requestGoogleSheetsAccessToken: vi.fn(),
}))

const recognizeReceiptImageMock = vi.mocked(recognizeReceiptImage)
const requestGoogleSheetsAccessTokenMock = vi.mocked(requestGoogleSheetsAccessToken)
const appendReceiptToGoogleSheetMock = vi.mocked(appendReceiptToGoogleSheet)
const downloadReceiptCsvMock = vi.mocked(downloadReceiptCsv)

describe('App integration', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    recognizeReceiptImageMock.mockResolvedValue({ text: receiptOcrText, confidence: 98 })
    requestGoogleSheetsAccessTokenMock.mockResolvedValue('test-access-token')
    appendReceiptToGoogleSheetMock.mockResolvedValue(undefined)
    mockCamera()
  })

  it('uploads a receipt image, extracts editable rows, saves to Google Sheets, and downloads CSV', async () => {
    render(<App />)

    uploadReceiptImage()

    await waitFor(() =>
      expect(screen.getByTestId('receipt-status')).toHaveTextContent('2 rows ready'),
    )
    expect(screen.getByDisplayValue('Fresh Mart')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bananas')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Oat Milk')).toBeInTheDocument()
    expect(screen.getByText('£5.75')).toBeInTheDocument()

    const firstRow = screen.getAllByTestId('item-row')[0]
    fireEvent.change(within(firstRow).getByLabelText('Item'), {
      target: { value: 'Organic Bananas' },
    })
    fireEvent.change(within(firstRow).getByLabelText('Price'), { target: { value: '1.50' } })

    fireEvent.change(screen.getByLabelText('Google Sheet link'), {
      target: { value: 'https://docs.google.com/spreadsheets/d/test-sheet-id/edit' },
    })
    fireEvent.change(screen.getByLabelText('Sheet tab'), { target: { value: 'June Receipts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to Google Sheet' }))

    await waitFor(() => expect(appendReceiptToGoogleSheetMock).toHaveBeenCalledTimes(1))
    expect(appendReceiptToGoogleSheetMock).toHaveBeenCalledWith(
      {
        sheetUrl: 'https://docs.google.com/spreadsheets/d/test-sheet-id/edit',
        sheetName: 'June Receipts',
        accessToken: 'test-access-token',
      },
      expect.objectContaining({
        merchant: 'Fresh Mart',
        items: expect.arrayContaining([
          expect.objectContaining({ name: 'Organic Bananas', totalPrice: 1.5 }),
        ]),
      }),
    )

    await waitFor(() =>
      expect(screen.getByTestId('receipt-status')).toHaveTextContent('Saved to Google Sheet'),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(downloadReceiptCsvMock).toHaveBeenCalledWith(
      expect.objectContaining({ merchant: 'Fresh Mart' }),
    )
  })

  it('shows a useful error when saving without a Google Sheets link', async () => {
    appendReceiptToGoogleSheetMock.mockRejectedValue(
      new Error('Add your Google Sheet link before saving.'),
    )

    render(<App />)

    uploadReceiptImage()
    await waitFor(() =>
      expect(screen.getByTestId('receipt-status')).toHaveTextContent('2 rows ready'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save to Google Sheet' }))

    await waitFor(() =>
      expect(screen.getByTestId('receipt-status')).toHaveTextContent(
        'Add your Google Sheet link before saving.',
      ),
    )
  })

  it('only enables the snap button when the camera can provide a frame', async () => {
    const onCapture = vi.fn()
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/jpeg;base64,capture',
    )

    const { container } = render(
      <MantineProvider theme={theme}>
        <ReceiptCamera onCapture={onCapture} onError={vi.fn()} />
      </MantineProvider>,
    )

    const snapButton = screen.getByRole('button', { name: 'Capture receipt' })
    expect(snapButton).toBeDisabled()

    const video = container.querySelector('video') as HTMLVideoElement
    Object.defineProperties(video, {
      readyState: { configurable: true, value: 2 },
      videoHeight: { configurable: true, value: 480 },
      videoWidth: { configurable: true, value: 640 },
    })

    fireEvent.canPlay(video)
    expect(snapButton).toBeEnabled()

    fireEvent.click(snapButton)

    expect(getContextSpy).toHaveBeenCalledWith('2d')
    expect(onCapture).toHaveBeenCalledWith('data:image/jpeg;base64,capture')
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
