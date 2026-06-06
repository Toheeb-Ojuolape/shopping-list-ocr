import { createWorker } from 'tesseract.js'
import type { LoggerMessage } from 'tesseract.js'

export type OcrProgress = {
  status: string
  progress: number
}

export type OcrResult = {
  text: string
  confidence: number
}

export async function recognizeReceiptImage(
  imageDataUri: string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  const fixtureText = import.meta.env.VITE_TEST_OCR_TEXT
  if (fixtureText) {
    onProgress?.({ status: 'fixture ocr', progress: 100 })
    return {
      text: fixtureText.replace(/\\n/g, '\n'),
      confidence: 99,
    }
  }

  const preparedImage = await prepareReceiptImage(imageDataUri)
  const worker = await createWorker('eng', 1, {
    logger: (message: LoggerMessage) => {
      onProgress?.({
        status: message.status,
        progress: Math.round(message.progress * 100),
      })
    },
  })

  try {
    await worker.setParameters({
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    })

    const result = await worker.recognize(preparedImage)
    return {
      text: result.data.text,
      confidence: Math.round(result.data.confidence),
    }
  } finally {
    await worker.terminate()
  }
}

async function prepareReceiptImage(imageDataUri: string): Promise<string> {
  if (typeof document === 'undefined') {
    return imageDataUri
  }

  const image = await loadImage(imageDataUri)
  const maxWidth = 1800
  const scale = Math.min(2, Math.max(1, maxWidth / image.width))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.width * scale)
  canvas.height = Math.round(image.height * scale)

  const context = canvas.getContext('2d')
  if (!context) {
    return imageDataUri
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const contrast = 1.18
  const midpoint = 128

  for (let index = 0; index < pixels.data.length; index += 4) {
    const red = pixels.data[index]
    const green = pixels.data[index + 1]
    const blue = pixels.data[index + 2]
    const gray = red * 0.299 + green * 0.587 + blue * 0.114
    const sharpened = Math.max(0, Math.min(255, (gray - midpoint) * contrast + midpoint))

    pixels.data[index] = sharpened
    pixels.data[index + 1] = sharpened
    pixels.data[index + 2] = sharpened
  }

  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.92)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load receipt image.'))
    image.src = src
  })
}
