import { Badge, Box, Button, Group, Paper, Text } from '@mantine/core'
import { IconReceipt, IconRefresh } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaptureStep } from './components/CaptureStep'
import { LoadingStep } from './components/LoadingStep'
import { ReviewStep } from './components/ReviewStep'
import { getCurrencyFromBrowserLocale, resolveLocalCurrency } from './lib/currency'
import { refineReceiptWithGemini } from './lib/gemini'
import { getCachedGoogleSheetsAccessToken, requestGoogleSheetsAccessToken } from './lib/googleAuth'
import { appendReceiptToGoogleSheet, downloadReceiptCsv } from './lib/googleSheets'
import { normalizeMerchantName } from './lib/ocrCorrection'
import { recognizeReceiptImage } from './lib/ocr'
import type { ReceiptExtraction, ReceiptItem } from './lib/receipt'
import { parseReceiptText, roundMoney, sumItems } from './lib/receipt'
import {
  getEnvGeminiKey,
  getEnvGoogleClientId,
  getSavedSheetSettings,
  getErrorMessage,
  getTodayIsoDate,
  saveSheetSettings,
  toReadableStatus,
  withToast,
} from './lib/utils'

type AppStep = 'capture' | 'review'
type WorkStatus = 'idle' | 'recognizing' | 'refining' | 'ready' | 'saving' | 'error'

const maxExportImageLength = 45_000
const envGeminiKey = getEnvGeminiKey()
const envGoogleClientId = getEnvGoogleClientId()
const savedSheetSettings = getSavedSheetSettings()

export function AppComponent() {
  const [step, setStep] = useState<AppStep>('capture')
  const [status, setStatus] = useState<WorkStatus>('idle')
  const [statusText, setStatusText] = useState('Ready when you are')
  const [progress, setProgress] = useState(0)
  const [extraction, setExtraction] = useState<ReceiptExtraction | undefined>()
  const activeReceiptIdRef = useRef<string | undefined>(undefined)
  const [sheetUrl, setSheetUrl] = useState(savedSheetSettings.sheetUrl)
  const [sheetName, setSheetName] = useState(savedSheetSettings.sheetName)
  const [googleAccessToken, setGoogleAccessToken] = useState(getCachedGoogleSheetsAccessToken())
  const [localCurrency, setLocalCurrency] = useState(getCurrencyFromBrowserLocale())

  const lineTotal = useMemo(() => sumItems(extraction?.items ?? []), [extraction])
  const isExtracting = status === 'recognizing' || status === 'refining'
  const isSaving = status === 'saving'
  const isGoogleConnected = Boolean(googleAccessToken)

  useEffect(() => {
    let mounted = true

    resolveLocalCurrency().then((currency) => {
      if (mounted) {
        setLocalCurrency(currency)
      }
    })

    return () => {
      mounted = false
    }
  }, [])

  function maybeRefineWeakExtraction(rawText: string, fallback: ReceiptExtraction) {
    if (!envGeminiKey.trim() || !shouldRefineWithGemini(fallback)) {
      return
    }

    refineReceiptWithGemini(envGeminiKey, rawText, fallback)
      .then((refined) => {
        if (
          activeReceiptIdRef.current !== fallback.receiptId ||
          refined.items.length < fallback.items.length
        ) {
          return
        }

        let appliedStatus: string | undefined
        setExtraction((current) => {
          if (
            !current ||
            current.receiptId !== fallback.receiptId ||
            current.items.length !== fallback.items.length
          ) {
            return current
          }

          const refinedWithImage = {
            ...refined,
            imageDataUri: fallback.imageDataUri,
            imageUrl: fallback.imageUrl,
          }
          appliedStatus = getReadyStatusText(refinedWithImage)
          return refinedWithImage
        })

        if (appliedStatus) {
          setStatus('ready')
          setStatusText(appliedStatus)
        }
      })
      .catch(() => {
        // Keep the local OCR result visible; Gemini is only a best-effort fallback.
      })
  }

  const extractReceipt = useCallback(
    async (imageDataUri: string) => {
      setStep('review')
      setExtraction(undefined)
      setStatus('recognizing')
      setStatusText('Reading your receipt')
      setProgress(8)

      try {
        const { ocrText, parsed, exportImageDataUri } = await withToast(
          async () => {
            const ocr = await recognizeReceiptImage(imageDataUri, (nextProgress) => {
              setProgress(nextProgress.progress)
              setStatusText(toReadableStatus(nextProgress.status))
            })

            return {
              ocrText: ocr.text,
              parsed: parseReceiptText(ocr.text, {
                defaultCurrency: localCurrency,
                defaultPurchasedAt: getTodayIsoDate(),
              }),
              exportImageDataUri: await prepareReceiptImageForExport(imageDataUri),
            }
          },
          {
            loading: 'Reading your receipt',
            success: ({ parsed }) => getReadyStatusText(parsed),
          },
        )
        const parsedWithImage = { ...parsed, imageDataUri: exportImageDataUri }
        activeReceiptIdRef.current = parsedWithImage.receiptId

        setStatus('ready')
        setStatusText(getReadyStatusText(parsedWithImage))
        setExtraction(parsedWithImage)
        setProgress(100)

        maybeRefineWeakExtraction(ocrText, parsedWithImage)
      } catch (error) {
        setStatus('error')
        setStatusText(getErrorMessage(error))
      }
    },
    [localCurrency],
  )

  const handleCameraError = useCallback((error: Error) => {
    setStatus('error')
    setStatusText(getErrorMessage(error))
  }, [])

  function handleUpload(file: File | null) {
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      extractReceipt(String(reader.result))
    }
    reader.readAsDataURL(file)
  }

  async function handleSaveToSheet() {
    if (!extraction) return

    setStatus('saving')
    setStatusText('Saving to Google Sheet')

    try {
      await withToast(
        async () => {
          const inferredMerchant = normalizeMerchantName(extraction.merchant)
          const extractionForSave = {
            ...extraction,
            merchant: inferredMerchant.value,
            purchasedAt: extraction.purchasedAt ?? getTodayIsoDate(),
          }

          if (
            inferredMerchant.value !== extraction.merchant ||
            extractionForSave.purchasedAt !== extraction.purchasedAt
          ) {
            setExtraction(extractionForSave)
          }

          const accessToken =
            googleAccessToken ||
            (await requestGoogleSheetsAccessToken(envGoogleClientId, { prompt: '' }))
          setGoogleAccessToken(accessToken)
          const saveResult = await appendReceiptToGoogleSheet(
            {
              sheetUrl,
              sheetName,
              accessToken,
            },
            extractionForSave,
          )
          if (saveResult.imageUrl && saveResult.imageUrl !== extractionForSave.imageUrl) {
            setExtraction({ ...extractionForSave, imageUrl: saveResult.imageUrl })
          }
          saveSheetSettings({ sheetUrl, sheetName })
        },
        {
          loading: 'Saving to Google Sheet',
          success: 'Saved to Google Sheet',
        },
      )
      setStatus('ready')
      setStatusText('Saved to Google Sheet')
    } catch (error) {
      setStatus('error')
      setStatusText(getErrorMessage(error))
    }
  }

  async function connectGoogle() {
    const accessToken = await requestGoogleSheetsAccessToken(envGoogleClientId, {
      prompt: 'consent',
    })
    setGoogleAccessToken(accessToken)
    return accessToken
  }

  async function handleConnectGoogle() {
    setStatus('saving')
    setStatusText('Connecting to Google')

    try {
      await withToast(connectGoogle, {
        loading: 'Connecting to Google',
        success: 'Google connected',
      })
      setStatus('ready')
      setStatusText('Google connected')
    } catch (error) {
      setStatus('error')
      setStatusText(getErrorMessage(error))
    }
  }

  function updateReceipt(patch: Partial<ReceiptExtraction>) {
    setExtraction((current) => (current ? { ...current, ...patch } : current))
  }

  function updateItem(id: string, patch: Partial<ReceiptItem>) {
    setExtraction((current) => {
      if (!current) return current
      const items = current.items.map((item) =>
        item.id === id ? applyItemPatch(item, patch) : item,
      )

      return {
        ...current,
        items,
        total: sumItems(items),
      }
    })
  }

  function addItem() {
    setExtraction((current) => {
      if (!current) return current
      const item: ReceiptItem = {
        id: `manual-${Date.now()}`,
        name: 'New item',
        quantity: 1,
        totalPrice: 0,
        currency: current.currency,
        confidence: 1,
      }

      const items = [...current.items, item]
      return { ...current, items, total: sumItems(items) }
    })
  }

  function removeItem(id: string) {
    setExtraction((current) => {
      if (!current) return current
      const items = current.items.filter((item) => item.id !== id)
      return { ...current, items, total: sumItems(items) }
    })
  }

  function startNewReceipt() {
    setStep('capture')
    setExtraction(undefined)
    activeReceiptIdRef.current = undefined
    setProgress(0)
    setStatus('idle')
    setStatusText('Ready when you are')
  }

  return (
    <Box component="main" className="receipt-app">
      <Paper component="div" className="app-shell" shadow="xl" radius={34}>
        <Group component="header" className="app-status" justify="space-between" wrap="nowrap">
          <Badge
            className="brand-mark"
            p={0}
            radius="md"
            color="receiptRed"
            aria-label="Receipt app"
            onClick={() => window.location.reload()}
            style={{ cursor: 'pointer' }}
          >
            <IconReceipt size={16} />
          </Badge>
          <Badge
            className={`status-chip ${status}`}
            data-testid="receipt-status"
            color={status === 'error' ? 'red' : status === 'ready' ? 'green' : 'receiptRed'}
            variant="light"
            fw={'bold'}
          >
            {statusText}
          </Badge>
        </Group>

        {step === 'capture' && (
          <CaptureStep
            statusText={statusText}
            onCapture={(dataUri) => extractReceipt(dataUri)}
            onUpload={handleUpload}
            onCameraError={handleCameraError}
          />
        )}

        {step === 'review' && isExtracting && (
          <LoadingStep statusText={statusText} progress={progress} />
        )}

        {step === 'review' && !isExtracting && extraction && (
          <ReviewStep
            extraction={extraction}
            lineTotal={lineTotal}
            statusText={statusText}
            isSaving={isSaving}
            sheetUrl={sheetUrl}
            sheetName={sheetName}
            isGoogleConnected={isGoogleConnected}
            hasGoogleClientId={Boolean(envGoogleClientId.trim())}
            onNewReceipt={startNewReceipt}
            onUpdateReceipt={updateReceipt}
            onUpdateItem={updateItem}
            onAddItem={addItem}
            onRemoveItem={removeItem}
            onSheetUrlChange={setSheetUrl}
            onSheetNameChange={setSheetName}
            onConnectGoogle={() => handleConnectGoogle()}
            onSaveToSheet={() => handleSaveToSheet()}
            onDownloadCsv={() => downloadReceiptCsv(extraction)}
          />
        )}

        {step === 'review' && !isExtracting && !extraction && (
          <Paper component="section" className="screen-card empty-review" shadow="none">
            <Text component="h1" fw={900}>
              We could not read that one
            </Text>
            <Text c="dimmed">{statusText}</Text>
            <Button leftSection={<IconRefresh size={18} />} onClick={startNewReceipt}>
              Try again
            </Button>
          </Paper>
        )}
      </Paper>
    </Box>
  )
}

function applyItemPatch(item: ReceiptItem, patch: Partial<ReceiptItem>): ReceiptItem {
  const nextItem = { ...item, ...patch }
  const quantityChanged = patch.quantity !== undefined
  const unitPriceChanged = patch.unitPrice !== undefined
  const totalPriceChanged = patch.totalPrice !== undefined

  if (quantityChanged || unitPriceChanged) {
    const quantity = Math.max(0, nextItem.quantity)
    const unitPrice =
      patch.unitPrice ??
      item.unitPrice ??
      (item.quantity > 0 ? roundMoney(item.totalPrice / item.quantity) : item.totalPrice)

    return {
      ...nextItem,
      quantity,
      unitPrice,
      totalPrice: roundMoney(unitPrice * quantity),
    }
  }

  if (totalPriceChanged) {
    return {
      ...nextItem,
      totalPrice: roundMoney(nextItem.totalPrice),
      unitPrice:
        nextItem.quantity > 1 ? roundMoney(nextItem.totalPrice / nextItem.quantity) : undefined,
    }
  }

  return nextItem
}

function getReadyStatusText(extraction: ReceiptExtraction): string {
  if (extraction.items.length === 0) {
    return 'No rows found'
  }

  return `${extraction.items.length} rows ready`
}

function shouldRefineWithGemini(extraction: ReceiptExtraction): boolean {
  if (extraction.items.length === 0) {
    return true
  }

  const averageConfidence =
    extraction.items.reduce((total, item) => total + item.confidence, 0) / extraction.items.length

  return averageConfidence < 0.72
}

async function prepareReceiptImageForExport(imageDataUri: string): Promise<string> {
  if (!imageDataUri.startsWith('data:image/') || imageDataUri.length <= maxExportImageLength) {
    return imageDataUri
  }

  try {
    const image = await loadImage(imageDataUri)
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!sourceWidth || !sourceHeight || !context) {
      return imageDataUri
    }

    let smallestImage = imageDataUri
    const maxWidths = [1000, 800, 640, 520, 420, 320, 260, 200]
    const qualities = [0.82, 0.7, 0.58, 0.46, 0.34, 0.26]

    for (const maxWidth of maxWidths) {
      const scale = Math.min(1, maxWidth / sourceWidth)
      canvas.width = Math.max(1, Math.round(sourceWidth * scale))
      canvas.height = Math.max(1, Math.round(sourceHeight * scale))

      for (const quality of qualities) {
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)

        const nextImage = canvas.toDataURL('image/jpeg', quality)
        if (nextImage.length < smallestImage.length) {
          smallestImage = nextImage
        }
        if (nextImage.length <= maxExportImageLength) {
          return nextImage
        }
      }
    }

    return smallestImage
  } catch {
    return imageDataUri
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not prepare receipt image for export.'))
    image.src = src
  })
}
