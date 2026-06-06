const googleIdentityScriptUrl = 'https://accounts.google.com/gsi/client'
const sheetsScope = 'https://www.googleapis.com/auth/spreadsheets'

type TokenResponse = {
  access_token?: string
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

export async function requestGoogleSheetsAccessToken(clientId: string): Promise<string> {
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

        resolve(response.access_token)
      },
    })

    if (!tokenClient) {
      reject(new Error('Google sign-in could not be loaded.'))
      return
    }

    tokenClient.requestAccessToken({ prompt: 'consent' })
  })
}

export function revokeGoogleAccessToken(accessToken: string): Promise<void> {
  if (!accessToken || !window.google?.accounts?.oauth2?.revoke) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    window.google?.accounts?.oauth2?.revoke(accessToken, resolve)
  })
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
      existingScript.addEventListener('error', () => reject(new Error('Google sign-in failed to load.')), {
        once: true,
      })
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
