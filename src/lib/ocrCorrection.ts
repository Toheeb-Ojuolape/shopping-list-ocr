import { WRatio, extract, ratio } from 'fuzzball'
import { groceryWordLexicon, merchantLexicon } from './receiptLexicon'

type CorrectionOptions = {
  minScore: number
  minMargin: number
}

type CorrectionResult = {
  value: string
  corrected: boolean
  score: number
}

type RankedMatch = {
  value: string
  score: number
}

const merchantOptions: CorrectionOptions = {
  minScore: 72,
  minMargin: 5,
}

const itemWordOptions: CorrectionOptions = {
  minScore: 65,
  minMargin: 5,
}

const itemWordLexicon = Array.from(new Set(groceryWordLexicon)).sort((left, right) =>
  left.localeCompare(right),
)
const itemWordSet = new Set(itemWordLexicon.map(normalizeComparable))
const merchantSet = new Set(merchantLexicon.map(normalizeComparable))

const genericMerchantTokens = new Set([
  'express',
  'food',
  'foods',
  'fresh',
  'grocery',
  'grocer',
  'market',
  'mart',
  'pharmacy',
  'shop',
  'store',
  'supermarket',
])

const ocrAlternates: Record<string, string[]> = {
  '0': ['o'],
  '1': ['i', 'l'],
  '2': ['z'],
  '5': ['s'],
  '6': ['g'],
  '8': ['b'],
  b: ['8'],
  c: ['e'],
  e: ['c'],
  g: ['6'],
  i: ['l', '1'],
  l: ['i', '1', 'r'],
  o: ['0'],
  r: ['l'],
  s: ['5'],
  z: ['2'],
}

export function inferMerchantName(value: string): CorrectionResult {
  const result = inferFromLexicon(value, merchantLexicon, merchantOptions, ratio)
  if (result.corrected && !hasMerchantTokenSupport(value, result.value)) {
    return {
      value: normalizeDisplayText(value),
      corrected: false,
      score: result.score,
    }
  }

  return result
}

export function normalizeMerchantName(value: string, fallback = 'Aldi'): CorrectionResult {
  const inferred = inferMerchantName(value)
  if (merchantSet.has(normalizeComparable(inferred.value))) {
    return inferred
  }

  return {
    value: fallback,
    corrected: normalizeComparable(value) !== normalizeComparable(fallback),
    score: 0,
  }
}

export function inferItemName(value: string): CorrectionResult {
  const cleaned = normalizeDisplayText(value)
  if (!cleaned) {
    return { value, corrected: false, score: 0 }
  }

  let correctedTokens = 0
  let totalScore = 0
  const corrected = cleaned.replace(/[a-z0-9]+/gi, (token) => {
    const result = inferItemWord(token)
    correctedTokens += 1
    totalScore += result.score
    return result.value
  })
  const changed = normalizeComparable(corrected) !== normalizeComparable(cleaned)

  return {
    value: corrected,
    corrected: changed,
    score: correctedTokens ? totalScore / correctedTokens : 1,
  }
}

export function inferFromLexicon(
  value: string,
  lexicon: readonly string[],
  options: CorrectionOptions,
  scorer: typeof ratio | typeof WRatio = WRatio,
): CorrectionResult {
  const cleaned = normalizeDisplayText(value)
  if (!cleaned) {
    return { value, corrected: false, score: 0 }
  }

  const ranked = rankMatches(cleaned, lexicon, scorer)
  const best = ranked[0]
  const second = ranked[1]
  const margin = best ? best.score - (second?.score ?? 0) : 0

  if (!best || best.score < options.minScore || margin < options.minMargin) {
    return { value: cleaned, corrected: false, score: (best?.score ?? 0) / 100 }
  }

  return {
    value: best.value,
    corrected: normalizeComparable(best.value) !== normalizeComparable(cleaned),
    score: best.score / 100,
  }
}

function inferItemWord(value: string): CorrectionResult {
  const cleaned = normalizeDisplayText(value)
  if (
    !cleaned ||
    cleaned.length <= 1 ||
    isReceiptModifierToken(cleaned) ||
    isKnownItemWord(cleaned)
  ) {
    return { value: cleaned, corrected: false, score: 1 }
  }

  const editDistanceMatch = inferShortWordByEditDistance(cleaned)
  if (editDistanceMatch) {
    return editDistanceMatch
  }

  const variants = buildOcrVariants(cleaned)
  const ranked =
    cleaned.length <= 4
      ? rankShortWordVariants(variants)
      : variants
          .flatMap((variant) =>
            rankMatches(variant.value, itemWordLexicon, WRatio, variant.penalty),
          )
          .sort((left, right) => right.score - left.score)

  const best = ranked[0]
  const second = ranked.find((match) => match.value !== best?.value)
  const margin = best ? best.score - (second?.score ?? 0) : 0

  if (
    !best ||
    best.score < itemWordOptions.minScore ||
    margin < itemWordOptions.minMargin ||
    !candidateLooksPlausible(cleaned, best.value)
  ) {
    return { value: cleaned, corrected: false, score: (best?.score ?? 0) / 100 }
  }

  return {
    value: best.value,
    corrected: normalizeComparable(best.value) !== normalizeComparable(cleaned),
    score: best.score / 100,
  }
}

function inferShortWordByEditDistance(value: string): CorrectionResult | undefined {
  if (value.length > 8) {
    return undefined
  }

  const maxDistance = value.length <= 4 ? 2 : 1
  const ranked = itemWordLexicon
    .filter((word) => {
      const source = normalizeComparable(value)
      const target = normalizeComparable(word)
      if (!firstCharacterIsCompatible(source, target)) {
        return false
      }

      if (source.length <= 4) {
        return target.length >= source.length && target.length <= source.length + 2
      }

      return target.length >= source.length - 1 && target.length <= source.length + 1
    })
    .map((word) => ({
      value: word,
      distance: levenshteinDistance(normalizeComparable(value), normalizeComparable(word)),
    }))
    .filter((match) => match.distance <= maxDistance)
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        Number(firstCharacterMatches(value, right.value)) -
          Number(firstCharacterMatches(value, left.value)) ||
        left.value.length - right.value.length,
    )

  const best = ranked[0]
  if (!best) {
    return undefined
  }

  return {
    value: best.value,
    corrected: normalizeComparable(best.value) !== normalizeComparable(value),
    score: 1 - best.distance / Math.max(value.length, best.value.length),
  }
}

function candidateLooksPlausible(source: string, candidate: string): boolean {
  const sourceLength = normalizeComparable(source).length
  const candidateLength = normalizeComparable(candidate).length
  return (
    candidateLength >= sourceLength - 1 &&
    candidateLength <= sourceLength + 3 &&
    firstCharacterIsCompatible(source, candidate)
  )
}

function firstCharacterIsCompatible(source: string, candidate: string): boolean {
  const sourceCharacter = normalizeComparable(source)[0]
  const candidateCharacter = normalizeComparable(candidate)[0]

  return (
    sourceCharacter === candidateCharacter ||
    (ocrAlternates[sourceCharacter] ?? []).includes(candidateCharacter) ||
    (ocrAlternates[candidateCharacter] ?? []).includes(sourceCharacter)
  )
}

function firstCharacterMatches(left: string, right: string): boolean {
  return normalizeComparable(left)[0] === normalizeComparable(right)[0]
}

function levenshteinDistance(left: string, right: string): number {
  const distances = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0),
  )

  for (let leftIndex = 0; leftIndex <= left.length; leftIndex += 1) {
    distances[leftIndex][0] = leftIndex
  }

  for (let rightIndex = 0; rightIndex <= right.length; rightIndex += 1) {
    distances[0][rightIndex] = rightIndex
  }

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      distances[leftIndex][rightIndex] = Math.min(
        distances[leftIndex - 1][rightIndex] + 1,
        distances[leftIndex][rightIndex - 1] + 1,
        distances[leftIndex - 1][rightIndex - 1] + substitutionCost,
      )
    }
  }

  return distances[left.length][right.length]
}

function rankMatches(
  query: string,
  choices: readonly string[],
  scorer: typeof ratio | typeof WRatio,
  penalty = 0,
): RankedMatch[] {
  return extract(query, [...choices], {
    scorer,
    limit: 5,
    cutoff: 0,
  }).map(([choice, score]) => ({
    value: choice,
    score: Math.max(0, score - penalty),
  }))
}

function rankShortWordVariants(variants: Array<{ value: string; penalty: number }>): RankedMatch[] {
  return variants
    .flatMap((variant) =>
      itemWordLexicon.map((word) => ({
        value: word,
        score: Math.max(0, WRatio(variant.value, word) - variant.penalty),
      })),
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
}

function buildOcrVariants(value: string): Array<{ value: string; penalty: number }> {
  const normalized = normalizeComparable(value)
  const variants = new Map<string, number>([[normalized, 0]])
  const insertionLetters = ['a', 'e', 'i', 'o', 'u', 'r']

  for (let index = 0; index < normalized.length; index += 1) {
    const alternates = ocrAlternates[normalized[index]] ?? []
    for (const alternate of alternates) {
      const variant = `${normalized.slice(0, index)}${alternate}${normalized.slice(index + 1)}`
      variants.set(variant, Math.min(variants.get(variant) ?? 4, 4))
    }
  }

  if (normalized.length <= 4) {
    for (const variant of Array.from(variants.keys())) {
      for (let index = 1; index < variant.length; index += 1) {
        for (const letter of insertionLetters) {
          const inserted = `${variant.slice(0, index)}${letter}${variant.slice(index)}`
          variants.set(inserted, Math.min(variants.get(inserted) ?? 8, 8))
        }
      }
    }
  }

  return Array.from(variants, ([variant, penalty]) => ({ value: variant, penalty }))
}

function isKnownItemWord(value: string): boolean {
  return itemWordSet.has(normalizeComparable(value))
}

function isReceiptModifierToken(value: string): boolean {
  return (
    /^[0-9]+(?:pk|g|kg|l|ml)?$/i.test(value) ||
    /^[a-z]\/[a-z]$/i.test(value) ||
    /^[a-z]{1,2}$/i.test(value)
  )
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

function hasMerchantTokenSupport(source: string, match: string): boolean {
  const matchTokens = tokenizeWords(match)
  const sourceTokens = tokenizeWords(source).filter(
    (token) => token.length > 2 && !genericMerchantTokens.has(token.toLowerCase()),
  )

  if (!sourceTokens.length) {
    return true
  }

  return sourceTokens.every((sourceToken) =>
    matchTokens.some((matchToken) => ratio(sourceToken, matchToken) >= 68),
  )
}
