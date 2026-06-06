import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { refineReceiptWithGemini } from './lib/gemini'
import {
  appendReceiptToGoogleSheet,
  createAppsScriptTemplate,
  downloadExcelWorkbook,
} from './lib/googleSheets'
import { recognizeReceiptImage } from './lib/ocr'
import type { CurrencyCode, ReceiptExtraction, ReceiptItem } from './lib/receipt'
import { parseReceiptText, roundMoney, sumItems } from './lib/receipt'

type WorkStatus = 'idle' | 'recognizing' | 'refining' | 'ready' | 'saving' | 'error'

const savedEndpoint = localStorage.getItem('receipt-sheet-endpoint') ?? ''
const savedSheetName = localStorage.getItem('receipt-sheet-name') ?? 'Receipts'
const envGeminiKey = import.meta.env.MODE === 'test' ? '' : (import.meta.env.VITE_GEMINI_API_KEY ?? '')

function App() {
  const [imageDataUri, setImageDataUri] = useState('')
  const [cameraOpen, setCameraOpen] = useState(true)
  const [status, setStatus] = useState<WorkStatus>('idle')
  const [statusText, setStatusText] = useState('Ready')
  const [progress, setProgress] = useState(0)
  const [ocrText, setOcrText] = useState('')
  const [extraction, setExtraction] = useState<ReceiptExtraction | undefined>()
  const [currency, setCurrency] = useState<CurrencyCode>('GBP')
  const [geminiKey, setGeminiKey] = useState(envGeminiKey)
  const [useGemini, setUseGemini] = useState(Boolean(envGeminiKey))
  const [sheetEndpoint, setSheetEndpoint] = useState(savedEndpoint)
  const [sheetName, setSheetName] = useState(savedSheetName)
  const [showScript, setShowScript] = useState(false)

  const lineTotal = useMemo(() => sumItems(extraction?.items ?? []), [extraction])
  const canExtract = Boolean(imageDataUri) && status !== 'recognizing' && status !== 'refining'
  const canSave = Boolean(extraction?.items.length) && status !== 'saving'

  const handleCameraError = useCallback((error: Error) => {
    setStatus('error')
    setStatusText(error.message)
  }, [])

  function handlePhoto(dataUri: string) {
    setImageDataUri(dataUri)
    setCameraOpen(false)
    setExtraction(undefined)
    setOcrText('')
    setProgress(0)
    setStatus('idle')
    setStatusText('Image captured')
  }

  function handleUpload(file: File | null) {
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => handlePhoto(String(reader.result))
    reader.readAsDataURL(file)
  }

  async function handleExtract() {
    if (!imageDataUri) return

    setStatus('recognizing')
    setStatusText('Reading receipt')
    setProgress(0)

    try {
      const ocr = await recognizeReceiptImage(imageDataUri, (nextProgress) => {
        setProgress(nextProgress.progress)
        setStatusText(toReadableStatus(nextProgress.status))
      })

      setOcrText(ocr.text)
      let parsed = parseReceiptText(ocr.text, { defaultCurrency: currency })

      if (useGemini && geminiKey.trim()) {
        setStatus('refining')
        setStatusText('Refining rows')
        parsed = await refineReceiptWithGemini(geminiKey, ocr.text, parsed)
      }

      setExtraction(parsed)
      setStatus('ready')
      setStatusText(`${parsed.items.length} rows ready`)
    } catch (error) {
      setStatus('error')
      setStatusText(error instanceof Error ? error.message : 'Receipt extraction failed')
    }
  }

  async function handleSaveToSheet() {
    if (!extraction) return

    setStatus('saving')
    setStatusText('Saving to Google Sheet')

    try {
      await appendReceiptToGoogleSheet(
        {
          endpointUrl: sheetEndpoint,
          sheetName,
        },
        extraction,
        imageDataUri,
      )
      localStorage.setItem('receipt-sheet-endpoint', sheetEndpoint)
      localStorage.setItem('receipt-sheet-name', sheetName)
      setStatus('ready')
      setStatusText('Saved to Google Sheet')
    } catch (error) {
      setStatus('error')
      setStatusText(error instanceof Error ? error.message : 'Google Sheet save failed')
    }
  }

  function updateItem(id: string, patch: Partial<ReceiptItem>) {
    setExtraction((current) => {
      if (!current) return current
      return {
        ...current,
        items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
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

      return { ...current, items: [...current.items, item] }
    })
  }

  function removeItem(id: string) {
    setExtraction((current) => {
      if (!current) return current
      return { ...current, items: current.items.filter((item) => item.id !== id) }
    })
  }

  function startNewReceipt() {
    setImageDataUri('')
    setCameraOpen(true)
    setExtraction(undefined)
    setOcrText('')
    setProgress(0)
    setStatus('idle')
    setStatusText('Ready')
  }

  return (
    <main className="receipt-app">
      <header className="topbar">
        <div>
          <p className="eyebrow">Receipt Ledger</p>
          <h1>Capture, extract, save.</h1>
        </div>
        <div className={`status-pill ${status}`} data-testid="receipt-status">
          <span>{statusText}</span>
        </div>
      </header>

      <section className="workspace">
        <div className="capture-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Camera</p>
              <h2>Receipt image</h2>
            </div>
            <button type="button" className="ghost-button" onClick={startNewReceipt}>
              New
            </button>
          </div>

          <div className="camera-frame">
            {cameraOpen && !imageDataUri ? (
              <ReceiptCamera onCapture={handlePhoto} onError={handleCameraError} />
            ) : (
              <div className="image-preview">
                {imageDataUri ? <img src={imageDataUri} alt="Captured receipt" /> : <span>No image</span>}
              </div>
            )}
          </div>

          <div className="capture-actions">
            <label className="file-button">
              Upload
              <input
                data-testid="receipt-upload"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => handleUpload(event.target.files?.[0] ?? null)}
              />
            </label>
            <button type="button" className="primary-button" disabled={!canExtract} onClick={handleExtract}>
              Extract
            </button>
          </div>

          {(status === 'recognizing' || status === 'refining') && (
            <div className="progress-track" aria-label="OCR progress">
              <span style={{ width: `${status === 'refining' ? 100 : progress}%` }} />
            </div>
          )}
        </div>

        <div className="results-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Items</p>
              <h2>Shopping list</h2>
            </div>
            <button type="button" className="ghost-button" disabled={!extraction} onClick={addItem}>
              Add row
            </button>
          </div>

          {extraction ? (
            <>
              <div className="receipt-meta">
                <label>
                  Merchant
                  <input
                    value={extraction.merchant}
                    onChange={(event) =>
                      setExtraction((current) =>
                        current ? { ...current, merchant: event.target.value } : current,
                      )
                    }
                  />
                </label>
                <label>
                  Date
                  <input
                    type="date"
                    value={extraction.purchasedAt ?? ''}
                    onChange={(event) =>
                      setExtraction((current) =>
                        current ? { ...current, purchasedAt: event.target.value } : current,
                      )
                    }
                  />
                </label>
              </div>

              <div className="item-list">
                {extraction.items.map((item) => (
                  <article className="item-row" data-testid="item-row" key={item.id}>
                    <label className="item-name">
                      Item
                      <input
                        value={item.name}
                        onChange={(event) => updateItem(item.id, { name: event.target.value })}
                      />
                    </label>
                    <label>
                      Qty
                      <input
                        inputMode="decimal"
                        value={item.quantity}
                        onChange={(event) =>
                          updateItem(item.id, { quantity: toPositiveNumber(event.target.value, 1) })
                        }
                      />
                    </label>
                    <label>
                      Price
                      <input
                        inputMode="decimal"
                        value={item.totalPrice}
                        onChange={(event) =>
                          updateItem(item.id, { totalPrice: toPositiveNumber(event.target.value, 0) })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => removeItem(item.id)}
                    >
                      Remove
                    </button>
                  </article>
                ))}
              </div>

              <div className="summary-strip">
                <div>
                  <span>Rows</span>
                  <strong>{extraction.items.length}</strong>
                </div>
                <div>
                  <span>Line total</span>
                  <strong>{formatMoney(lineTotal, extraction.currency)}</strong>
                </div>
                <div>
                  <span>Receipt total</span>
                  <strong>{formatMoney(extraction.total ?? lineTotal, extraction.currency)}</strong>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h2>Waiting for a receipt</h2>
              <p>Snap or upload an image, then run extraction.</p>
            </div>
          )}
        </div>

        <aside className="settings-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Save</p>
              <h2>Destinations</h2>
            </div>
          </div>

          <div className="field-grid">
            <label>
              Currency
              <select value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}>
                <option value="GBP">GBP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={useGemini}
                onChange={(event) => setUseGemini(event.target.checked)}
              />
              <span>Gemini refine</span>
            </label>
            <label className="full-field">
              Gemini API key
              <input
                type="password"
                autoComplete="off"
                value={geminiKey}
                onChange={(event) => setGeminiKey(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className="full-field">
              Apps Script URL
              <input
                value={sheetEndpoint}
                onChange={(event) => setSheetEndpoint(event.target.value)}
                placeholder="https://script.google.com/macros/s/..."
              />
            </label>
            <label>
              Sheet tab
              <input value={sheetName} onChange={(event) => setSheetName(event.target.value)} />
            </label>
          </div>

          <div className="save-actions">
            <button type="button" className="primary-button" disabled={!canSave} onClick={handleSaveToSheet}>
              Save to Sheet
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!extraction}
              onClick={() => extraction && downloadExcelWorkbook(extraction, imageDataUri)}
            >
              Download XLS
            </button>
          </div>

          <button type="button" className="text-button" onClick={() => setShowScript((value) => !value)}>
            {showScript ? 'Hide script' : 'Apps Script'}
          </button>
          {showScript && <textarea className="script-box" readOnly value={createAppsScriptTemplate()} />}

          {ocrText && (
            <details className="raw-text">
              <summary>Raw OCR</summary>
              <pre>{ocrText}</pre>
            </details>
          )}
        </aside>
      </section>
    </main>
  )
}

function ReceiptCamera({
  onCapture,
  onError,
}: {
  onCapture: (dataUri: string) => void
  onError: (error: Error) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let stream: MediaStream | undefined
    let isMounted = true

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        onError(new Error('Camera access needs localhost, HTTPS, and a supported browser.'))
        return
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1440 },
            height: { ideal: 1920 },
          },
        })

        if (videoRef.current && isMounted) {
          videoRef.current.srcObject = stream
          setIsReady(true)
        }
      } catch (error) {
        onError(error instanceof Error ? error : new Error('Camera unavailable.'))
      }
    }

    startCamera()

    return () => {
      isMounted = false
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [onError])

  function captureFrame() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      onError(new Error('Camera is still warming up.'))
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      onError(new Error('Could not capture a camera frame.'))
      return
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    onCapture(canvas.toDataURL('image/jpeg', 0.92))
  }

  return (
    <div className="live-camera">
      <video ref={videoRef} autoPlay muted playsInline />
      <button type="button" className="shutter-button" disabled={!isReady} onClick={captureFrame}>
        Capture
      </button>
    </div>
  )
}

function toPositiveNumber(value: string, fallback: number): number {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? roundMoney(parsed) : fallback
}

function toReadableStatus(status: string): string {
  return status
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatMoney(value: number, currency: CurrencyCode): string {
  if (currency === 'UNKNOWN') {
    return value.toFixed(2)
  }

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(value)
}

export default App
