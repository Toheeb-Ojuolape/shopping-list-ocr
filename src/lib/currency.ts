import type { CurrencyCode } from './receipt'

type IpCurrencyResponse = {
  currency?: string
  country_code?: string
}

const ipCurrencyEndpoint = 'https://ipapi.co/json/'
const currencyLookupTimeoutMs = 2500

const currencyByCountry: Record<string, CurrencyCode> = {
  AD: 'EUR',
  AE: 'AED',
  AF: 'AFN',
  AG: 'XCD',
  AI: 'XCD',
  AL: 'ALL',
  AM: 'AMD',
  AO: 'AOA',
  AR: 'ARS',
  AS: 'USD',
  AT: 'EUR',
  AU: 'AUD',
  AW: 'AWG',
  AX: 'EUR',
  AZ: 'AZN',
  BA: 'BAM',
  BB: 'BBD',
  BD: 'BDT',
  BE: 'EUR',
  BF: 'XOF',
  BG: 'BGN',
  BH: 'BHD',
  BI: 'BIF',
  BJ: 'XOF',
  BM: 'BMD',
  BN: 'BND',
  BO: 'BOB',
  BR: 'BRL',
  BS: 'BSD',
  BT: 'BTN',
  BW: 'BWP',
  BY: 'BYN',
  BZ: 'BZD',
  CA: 'CAD',
  CD: 'CDF',
  CF: 'XAF',
  CG: 'XAF',
  CH: 'CHF',
  CI: 'XOF',
  CL: 'CLP',
  CM: 'XAF',
  CN: 'CNY',
  CO: 'COP',
  CR: 'CRC',
  CU: 'CUP',
  CV: 'CVE',
  CY: 'EUR',
  CZ: 'CZK',
  DE: 'EUR',
  DK: 'DKK',
  DO: 'DOP',
  DZ: 'DZD',
  EC: 'USD',
  EE: 'EUR',
  EG: 'EGP',
  ES: 'EUR',
  ET: 'ETB',
  FI: 'EUR',
  FJ: 'FJD',
  FR: 'EUR',
  GB: 'GBP',
  GE: 'GEL',
  GH: 'GHS',
  GI: 'GIP',
  GM: 'GMD',
  GN: 'GNF',
  GQ: 'XAF',
  GR: 'EUR',
  GT: 'GTQ',
  HK: 'HKD',
  HN: 'HNL',
  HR: 'EUR',
  HT: 'HTG',
  HU: 'HUF',
  ID: 'IDR',
  IE: 'EUR',
  IL: 'ILS',
  IN: 'INR',
  IQ: 'IQD',
  IR: 'IRR',
  IS: 'ISK',
  IT: 'EUR',
  JM: 'JMD',
  JO: 'JOD',
  JP: 'JPY',
  KE: 'KES',
  KG: 'KGS',
  KH: 'KHR',
  KR: 'KRW',
  KW: 'KWD',
  KZ: 'KZT',
  LB: 'LBP',
  LK: 'LKR',
  LR: 'LRD',
  LT: 'EUR',
  LU: 'EUR',
  LV: 'EUR',
  LY: 'LYD',
  MA: 'MAD',
  MC: 'EUR',
  MD: 'MDL',
  ME: 'EUR',
  MG: 'MGA',
  MK: 'MKD',
  ML: 'XOF',
  MM: 'MMK',
  MN: 'MNT',
  MO: 'MOP',
  MT: 'EUR',
  MU: 'MUR',
  MV: 'MVR',
  MW: 'MWK',
  MX: 'MXN',
  MY: 'MYR',
  MZ: 'MZN',
  NA: 'NAD',
  NE: 'XOF',
  NG: 'NGN',
  NI: 'NIO',
  NL: 'EUR',
  NO: 'NOK',
  NP: 'NPR',
  NZ: 'NZD',
  OM: 'OMR',
  PA: 'PAB',
  PE: 'PEN',
  PG: 'PGK',
  PH: 'PHP',
  PK: 'PKR',
  PL: 'PLN',
  PT: 'EUR',
  PY: 'PYG',
  QA: 'QAR',
  RO: 'RON',
  RS: 'RSD',
  RU: 'RUB',
  RW: 'RWF',
  SA: 'SAR',
  SD: 'SDG',
  SE: 'SEK',
  SG: 'SGD',
  SI: 'EUR',
  SK: 'EUR',
  SN: 'XOF',
  SO: 'SOS',
  SV: 'USD',
  TH: 'THB',
  TJ: 'TJS',
  TM: 'TMT',
  TN: 'TND',
  TR: 'TRY',
  TT: 'TTD',
  TW: 'TWD',
  TZ: 'TZS',
  UA: 'UAH',
  UG: 'UGX',
  US: 'USD',
  UY: 'UYU',
  UZ: 'UZS',
  VE: 'VES',
  VN: 'VND',
  XK: 'EUR',
  ZA: 'ZAR',
  ZM: 'ZMW',
  ZW: 'ZWL',
}

export async function resolveLocalCurrency(): Promise<CurrencyCode> {
  if (import.meta.env.MODE === 'test') {
    return getCurrencyFromBrowserLocale()
  }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), currencyLookupTimeoutMs)

  try {
    const response = await fetch(ipCurrencyEndpoint, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Currency lookup failed with HTTP ${response.status}.`)
    }

    const body = (await response.json()) as IpCurrencyResponse
    return (
      normalizeCurrencyCode(body.currency) ??
      getCurrencyFromCountryCode(body.country_code) ??
      getCurrencyFromBrowserLocale()
    )
  } catch {
    return getCurrencyFromBrowserLocale()
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export function getCurrencyFromBrowserLocale(locale = navigator.language): CurrencyCode {
  const region = locale.match(/[-_]([a-z]{2})\b/i)?.[1]
  return getCurrencyFromCountryCode(region) ?? 'USD'
}

function getCurrencyFromCountryCode(countryCode?: string): CurrencyCode | undefined {
  if (!countryCode) {
    return undefined
  }

  return currencyByCountry[countryCode.toUpperCase()]
}

function normalizeCurrencyCode(value?: string): CurrencyCode | undefined {
  const normalized = value?.trim().toUpperCase()
  if (!normalized || !/^[A-Z]{3}$/.test(normalized)) {
    return undefined
  }

  try {
    new Intl.NumberFormat(undefined, { style: 'currency', currency: normalized }).format(1)
    return normalized
  } catch {
    return undefined
  }
}
