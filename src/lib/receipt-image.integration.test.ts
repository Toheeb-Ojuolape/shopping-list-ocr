// @vitest-environment node

import { createWorker, PSM } from 'tesseract.js'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { parseReceiptText, sumItems } from './receipt'

describe('real receipt image OCR integration', () => {
  it('parses the canonical Aldi receipt OCR fixture', async () => {
    const ocrText = await readSampleReceiptOcrText()
    const extraction = parseReceiptText(ocrText, {
      defaultCurrency: 'GBP',
      defaultPurchasedAt: '2026-06-06',
    })
    const expectedRows = await readExpectedSampleRows()
    const expectedItemNames = new Set([
      ...expectedRows.map((row) => row.item.toUpperCase()),
      'BISCUIT AST 700G',
    ])
    const extractedNames = new Set(extraction.items.map((item) => item.name.toUpperCase()))

    expect(extraction.merchant).toBe('ALDI STORES')
    expect(extraction.total).toBe(29.47)
    expect(sumItems(extraction.items)).toBe(29.47)
    expect(extraction.items.reduce((total, item) => total + item.quantity, 0)).toBe(24)
    expect(extractedNames).toEqual(expectedItemNames)
    expect(extraction.items.some((item) => /total/i.test(item.name))).toBe(false)
  })

  it('recognizes useful receipt text from the actual image fixture', async () => {
    const ocrText = await recognizeSampleReceiptFixture()
    const extraction = parseReceiptText(ocrText, {
      defaultCurrency: 'GBP',
      defaultPurchasedAt: '2026-06-06',
    })
    const expectedRows = await readExpectedSampleRows()
    const expectedItemNames = new Set(expectedRows.map((row) => row.item.toUpperCase()))
    const matchedExpectedItems = extraction.items.filter((item) =>
      expectedItemNames.has(item.name.toUpperCase()),
    )

    expect(ocrText.length).toBeGreaterThan(500)
    expect(extraction.merchant).toBe('ALDI STORES')
    expect(extraction.items.length).toBeGreaterThanOrEqual(12)
    expect(matchedExpectedItems.length).toBeGreaterThanOrEqual(8)
    expect(extraction.items.some((item) => /total/i.test(item.name))).toBe(false)
  }, 90_000)
})

async function recognizeSampleReceiptFixture(): Promise<string> {
  const sourcePath = path.join(process.cwd(), 'src/test/sample-receipt.jpg')
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'receipt-ocr-'))
  const variants = [
    path.join(tempDir, 'receipt-linear.jpg'),
    path.join(tempDir, 'receipt-threshold.jpg'),
    path.join(tempDir, 'receipt-sparse.jpg'),
    path.join(tempDir, 'receipt-top.jpg'),
    path.join(tempDir, 'receipt-lower.jpg'),
    path.join(tempDir, 'receipt-total.jpg'),
  ]

  const base = sharp(sourcePath).extract({ left: 520, top: 520, width: 2200, height: 4000 })
  await base
    .clone()
    .resize({ width: 2200 })
    .modulate({ brightness: 1.08 })
    .grayscale()
    .linear(1.8, -80)
    .sharpen()
    .toFile(variants[0])
  await base
    .clone()
    .resize({ width: 2200 })
    .grayscale()
    .normalize()
    .threshold(165)
    .sharpen()
    .toFile(variants[1])
  await base.clone().resize({ width: 2200 }).grayscale().normalize().sharpen().toFile(variants[2])
  await sharp(sourcePath)
    .extract({ left: 700, top: 1450, width: 1800, height: 700 })
    .resize({ width: 2400 })
    .grayscale()
    .normalize()
    .linear(2, -90)
    .sharpen()
    .toFile(variants[3])
  await sharp(sourcePath)
    .extract({ left: 450, top: 2600, width: 2400, height: 1900 })
    .resize({ width: 2400 })
    .grayscale()
    .normalize()
    .linear(1.8, -80)
    .sharpen()
    .toFile(variants[4])
  await sharp(sourcePath)
    .extract({ left: 500, top: 4200, width: 2300, height: 320 })
    .resize({ width: 2600 })
    .grayscale()
    .normalize()
    .linear(1.7, -70)
    .sharpen()
    .toFile(variants[5])

  const worker = await createWorker('eng', 1, {
    cacheMethod: 'none',
    cachePath: path.join(os.tmpdir(), 'shopping-list-tessdata'),
    corePath: path.join(
      process.cwd(),
      'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
    ),
    langPath: path.join(process.cwd(), 'node_modules/@tesseract.js-data/eng/4.0.0'),
  })
  await worker.setParameters({
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
  })

  try {
    const results = []
    for (const [index, variant] of variants.entries()) {
      await worker.setParameters({
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
        tessedit_pageseg_mode:
          index === 2 ? PSM.SPARSE_TEXT : index === 5 ? PSM.SINGLE_LINE : PSM.SINGLE_BLOCK,
      })
      const result = await worker.recognize(variant)
      results.push(result.data.text)
    }

    return results.join('\n')
  } finally {
    await worker.terminate()
    await fs.rm(tempDir, { force: true, recursive: true })
  }
}

async function readExpectedSampleRows(): Promise<Array<{ item: string }>> {
  const csvPath = path.join(process.cwd(), 'src/test/sample-receipt-result.csv')
  const [, ...rows] = (await fs.readFile(csvPath, 'utf8')).trim().split(/\r?\n/)

  return rows.map((row) => {
    const [, , , item] = row.split(',')
    return { item }
  })
}

async function readSampleReceiptOcrText(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), 'src/test/sample-receipt-ocr.txt'), 'utf8')
}
