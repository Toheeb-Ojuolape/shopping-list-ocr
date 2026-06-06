import { groceryItemLexicon, merchantLexicon } from './receiptLexicon'

type CorrectionOptions = {
  minScore: number
  minMargin: number
}

type CorrectionResult = {
  value: string
  corrected: boolean
  score: number
}

const defaultItemOptions: CorrectionOptions = {
  minScore: 0.66,
  minMargin: 0.04,
}

const defaultMerchantOptions: CorrectionOptions = {
  minScore: 0.72,
  minMargin: 0.05,
}

const ocrConfusions = new Set([
  '0o',
  'o0',
  '1i',
  'i1',
  '1l',
  'l1',
  'il',
  'li',
  '5s',
  's5',
  '8b',
  'b8',
  '2z',
  'z2',
  '6g',
  'g6',
  'cld',
  'dcl',
  'rni',
  'imr',
])

export function inferMerchantName(value: string): CorrectionResult {
  return inferFromLexicon(value, merchantLexicon, defaultMerchantOptions)
}

export function inferItemName(value: string): CorrectionResult {
  const phraseMatch = inferFromLexicon(value, groceryItemLexicon, {
    minScore: 0.74,
    minMargin: 0.04,
  })

  if (phraseMatch.corrected || exactLexiconMatch(value, groceryItemLexicon)) {
    return phraseMatch
  }

  const correctedTokens = tokenizeWords(value).map((token) => {
    const tokenMatch = inferFromLexicon(token, groceryItemLexicon, defaultItemOptions)
    return tokenMatch.corrected ? tokenMatch.value : token
  })

  const corrected = correctedTokens.join(' ')
  return {
    value: corrected,
    corrected: normalizeComparable(corrected) !== normalizeComparable(value),
    score: corrected === value ? 1 : phraseMatch.score,
  }
}

export function inferFromLexicon(
  value: string,
  lexicon: readonly string[],
  options: CorrectionOptions,
): CorrectionResult {
  const cleaned = normalizeDisplayText(value)
  if (!cleaned) {
    return { value, corrected: false, score: 0 }
  }

  const ranked = lexicon
    .map((entry) => ({
      entry,
      score: scoreTextSimilarity(cleaned, entry),
    }))
    .sort((left, right) => right.score - left.score)

  const best = ranked[0]
  const second = ranked[1]
  const margin = best ? best.score - (second?.score ?? 0) : 0

  if (!best || best.score < options.minScore || margin < options.minMargin) {
    return { value: cleaned, corrected: false, score: best?.score ?? 0 }
  }

  return {
    value: best.entry,
    corrected: normalizeComparable(best.entry) !== normalizeComparable(cleaned),
    score: best.score,
  }
}

export function scoreTextSimilarity(left: string, right: string): number {
  const editScore = scoreCharacterSimilarity(left, right)
  const tokenScore = scoreTokenSimilarity(left, right)

  return roundScore(Math.max(editScore, tokenScore))
}

function scoreCharacterSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeComparable(left)
  const normalizedRight = normalizeComparable(right)
  if (!normalizedLeft || !normalizedRight) {
    return 0
  }

  if (normalizedLeft === normalizedRight) {
    return 1
  }

  const distance = weightedEditDistance(normalizedLeft, normalizedRight)
  return roundScore(1 - distance / Math.max(normalizedLeft.length, normalizedRight.length))
}

function weightedEditDistance(source: string, target: string): number {
  const rows = source.length + 1
  const cols = target.length + 1
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0))

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row
  }

  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const substitution = matrix[row - 1][col - 1] + substitutionCost(source[row - 1], target[col - 1])
      const deletion = matrix[row - 1][col] + 1
      const insertion = matrix[row][col - 1] + 1
      let cost = Math.min(substitution, deletion, insertion)

      if (
        row > 1 &&
        col > 1 &&
        source[row - 1] === target[col - 2] &&
        source[row - 2] === target[col - 1]
      ) {
        cost = Math.min(cost, matrix[row - 2][col - 2] + 0.7)
      }

      matrix[row][col] = cost
    }
  }

  return matrix[source.length][target.length]
}

function substitutionCost(left: string, right: string): number {
  if (left === right) {
    return 0
  }

  if (ocrConfusions.has(`${left}${right}`)) {
    return 0.25
  }

  return 1
}

function scoreTokenSimilarity(left: string, right: string): number {
  const leftTokens = tokenizeWords(left)
  const rightTokens = tokenizeWords(right)
  if (!leftTokens.length || !rightTokens.length) {
    return 0
  }

  const scores = leftTokens.map((leftToken) =>
    Math.max(...rightTokens.map((rightToken) => scoreCharacterSimilarity(leftToken, rightToken))),
  )

  return scores.reduce((total, score) => total + score, 0) / scores.length
}

function exactLexiconMatch(value: string, lexicon: readonly string[]): boolean {
  const normalized = normalizeComparable(value)
  return lexicon.some((entry) => normalizeComparable(entry) === normalized)
}

function normalizeDisplayText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeComparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function tokenizeWords(value: string): string[] {
  return value.match(/[a-z0-9]+/gi) ?? []
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000))
}
