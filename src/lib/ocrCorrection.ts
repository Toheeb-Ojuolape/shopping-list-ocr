import { WRatio, extract, ratio, token_set_ratio } from 'fuzzball'
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

type RankedMatch = {
  value: string
  score: number
}

const merchantOptions: CorrectionOptions = {
  minScore: 72,
  minMargin: 5,
}

const itemPhraseOptions: CorrectionOptions = {
  minScore: 84,
  minMargin: 5,
}

const itemWordOptions: CorrectionOptions = {
  minScore: 72,
  minMargin: 7,
}

const itemWordLexicon = Array.from(
  new Set(groceryItemLexicon.flatMap((item) => tokenizeWords(item))),
).sort((left, right) => left.localeCompare(right))

const itemWordSet = new Set(itemWordLexicon.map(normalizeComparable))

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
  return inferFromLexicon(value, merchantLexicon, merchantOptions, ratio)
}

export function inferItemName(value: string): CorrectionResult {
  const cleaned = normalizeDisplayText(value)
  if (!cleaned) {
    return { value, corrected: false, score: 0 }
  }

  const phraseMatch = inferFromLexicon(cleaned, groceryItemLexicon, itemPhraseOptions, token_set_ratio)
  if (
    (phraseMatch.corrected && shouldUsePhraseMatch(cleaned, phraseMatch.value)) ||
    exactLexiconMatch(cleaned, groceryItemLexicon)
  ) {
    return phraseMatch
  }

  const corrected = cleaned.replace(/[a-z0-9]+/gi, (token) => inferItemWord(token).value)

  return {
    value: corrected,
    corrected: normalizeComparable(corrected) !== normalizeComparable(cleaned),
    score: corrected === cleaned ? 1 : phraseMatch.score,
  }
}

export function inferFromLexicon(
  value: string,
  lexicon: readonly string[],
  options: CorrectionOptions,
  scorer: typeof ratio | typeof token_set_ratio | typeof WRatio = WRatio,
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
  if (!cleaned || isKnownItemWord(cleaned)) {
    return { value: cleaned, corrected: false, score: 1 }
  }

  const variants = buildOcrVariants(cleaned)
  const ranked = variants
    .flatMap((variant) => rankMatches(variant.value, itemWordLexicon, ratio, variant.penalty))
    .sort((left, right) => right.score - left.score)

  const best = ranked[0]
  const second = ranked.find((match) => match.value !== best?.value)
  const margin = best ? best.score - (second?.score ?? 0) : 0

  if (!best || best.score < itemWordOptions.minScore || margin < itemWordOptions.minMargin) {
    return { value: cleaned, corrected: false, score: (best?.score ?? 0) / 100 }
  }

  return {
    value: best.value,
    corrected: normalizeComparable(best.value) !== normalizeComparable(cleaned),
    score: best.score / 100,
  }
}

function rankMatches(
  query: string,
  choices: readonly string[],
  scorer: typeof ratio | typeof token_set_ratio | typeof WRatio,
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

function buildOcrVariants(value: string): Array<{ value: string; penalty: number }> {
  const normalized = normalizeComparable(value)
  const variants = new Map<string, number>([[normalized, 0]])

  for (let index = 0; index < normalized.length; index += 1) {
    const alternates = ocrAlternates[normalized[index]] ?? []
    for (const alternate of alternates) {
      const variant = `${normalized.slice(0, index)}${alternate}${normalized.slice(index + 1)}`
      variants.set(variant, Math.min(variants.get(variant) ?? 4, 4))
    }
  }

  return Array.from(variants, ([variant, penalty]) => ({ value: variant, penalty }))
}

function isKnownItemWord(value: string): boolean {
  return itemWordSet.has(normalizeComparable(value))
}

function exactLexiconMatch(value: string, lexicon: readonly string[]): boolean {
  const normalized = normalizeComparable(value)
  return lexicon.some((entry) => normalizeComparable(entry) === normalized)
}

function shouldUsePhraseMatch(source: string, match: string): boolean {
  const sourceTokenCount = tokenizeWords(source).length
  const matchTokenCount = tokenizeWords(match).length

  return matchTokenCount >= sourceTokenCount
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
