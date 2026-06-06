const googleIdentityScriptUrl = 'https://accounts.google.com/gsi/client'
const sheetsScope = 'https://www.googleapis.com/auth/spreadsheets'

type TokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type TokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void
}

type TokenClientConfig = {
  client_id: string
  scope: string
  callback: (response: TokenResponse) => void
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: TokenClientConfig) => TokenClient
          revoke: (token: string, done: () => void) => void
        }
      }
    }
  }
}

let loadGoogleIdentityPromise: Promise<void> | undefined
const cachedTokenKey = 'receipt-google-access-token'
const cachedTokenExpiryKey = 'receipt-google-access-token-expires-at'

export type GoogleTokenRequestOptions = {
  prompt?: 'consent' | ''
}

export function getCachedGoogleSheetsAccessToken(): string {
  const token = localStorage.getItem(cachedTokenKey) ?? ''
  const expiresAt = Number(localStorage.getItem(cachedTokenExpiryKey) ?? 0)

  if (!token || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    clearCachedGoogleSheetsAccessToken()
    return ''
  }

  return token
}

export async function requestGoogleSheetsAccessToken(
  clientId: string,
  options: GoogleTokenRequestOptions = {},
): Promise<string> {
  const cachedToken = getCachedGoogleSheetsAccessToken()
  if (cachedToken) {
    return cachedToken
  }

  const trimmedClientId = clientId.trim()
  if (!trimmedClientId) {
    throw new Error('Add VITE_GOOGLE_CLIENT_ID before saving to Google Sheets.')
  }

  await loadGoogleIdentity()

  return new Promise((resolve, reject) => {
    const tokenClient = window.google?.accounts?.oauth2?.initTokenClient({
      client_id: trimmedClientId,
      scope: sheetsScope,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error))
          return
        }

        if (!response.access_token) {
          reject(new Error('Google did not return an access token.'))
          return
        }

        cacheGoogleSheetsAccessToken(response.access_token, response.expires_in)
        resolve(response.access_token)
      },
    })

    if (!tokenClient) {
      reject(new Error('Google sign-in could not be loaded.'))
      return
    }

    tokenClient.requestAccessToken({ prompt: options.prompt ?? 'consent' })
  })
}

export function revokeGoogleAccessToken(accessToken: string): Promise<void> {
  clearCachedGoogleSheetsAccessToken()

  if (!accessToken || !window.google?.accounts?.oauth2?.revoke) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    window.google?.accounts?.oauth2?.revoke(accessToken, resolve)
  })
}

function cacheGoogleSheetsAccessToken(accessToken: string, expiresIn = 3600): void {
  const expiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000
  localStorage.setItem(cachedTokenKey, accessToken)
  localStorage.setItem(cachedTokenExpiryKey, String(expiresAt))
}

function clearCachedGoogleSheetsAccessToken(): void {
  localStorage.removeItem(cachedTokenKey)
  localStorage.removeItem(cachedTokenExpiryKey)
}

function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve()
  }

  loadGoogleIdentityPromise ??= new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${googleIdentityScriptUrl}"]`,
    )

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true })
      existingScript.addEventListener(
        'error',
        () => reject(new Error('Google sign-in failed to load.')),
        {
          once: true,
        },
      )
      return
    }

    const script = document.createElement('script')
    script.src = googleIdentityScriptUrl
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google sign-in failed to load.'))
    document.head.appendChild(script)
  })

  return loadGoogleIdentityPromise
}
