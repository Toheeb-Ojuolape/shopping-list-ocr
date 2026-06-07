import type { ReceiptExtraction } from './receipt'

export type UploadedReceiptImage = {
  fileId: string
  imageUrl: string
}

type DriveFileResponse = {
  id?: string
}

const driveApiUrl = 'https://www.googleapis.com/drive/v3'
const driveUploadUrl = 'https://www.googleapis.com/upload/drive/v3/files'

export async function uploadReceiptImageToDrive(
  accessToken: string,
  extraction: ReceiptExtraction,
): Promise<UploadedReceiptImage | undefined> {
  if (!extraction.imageDataUri) {
    return undefined
  }

  const imageBlob = await dataUriToBlob(extraction.imageDataUri)
  const fileName = `${extraction.receiptId}.jpg`
  const file = await uploadImageFile(accessToken, imageBlob, fileName, extraction)
  if (!file.id) {
    throw new Error('Google Drive did not return an uploaded image ID.')
  }

  await makeFileViewableByLink(accessToken, file.id)

  return {
    fileId: file.id,
    imageUrl: createGoogleUserContentImageUrl(file.id),
  }
}

export function createGoogleUserContentImageUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w900`
}

async function uploadImageFile(
  accessToken: string,
  imageBlob: Blob,
  fileName: string,
  extraction: ReceiptExtraction,
): Promise<DriveFileResponse> {
  const boundary = `receipt-image-${crypto.randomUUID()}`
  const metadata = {
    name: fileName,
    mimeType: imageBlob.type || 'image/jpeg',
    description: `Receipt image for ${extraction.merchant} (${extraction.receiptId})`,
  }
  const body = new Blob(
    [
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\n`,
      `Content-Type: ${metadata.mimeType}\r\n\r\n`,
      imageBlob,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  )

  return fetchJson<DriveFileResponse>(
    `${driveUploadUrl}?uploadType=multipart&fields=id`,
    accessToken,
    {
      method: 'POST',
      body,
      headers: {
        'Content-Type': body.type,
      },
    },
  )
}

async function makeFileViewableByLink(accessToken: string, fileId: string): Promise<void> {
  await fetchJson(
    `${driveApiUrl}/files/${encodeURIComponent(
      fileId,
    )}/permissions?sendNotificationEmail=false&fields=id`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
      }),
    },
  )
}

async function dataUriToBlob(dataUri: string): Promise<Blob> {
  const response = await fetch(dataUri)
  if (!response.ok) {
    throw new Error('Could not prepare receipt image for Google Drive.')
  }

  return response.blob()
}

async function fetchJson<T>(url: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })

  if (!response.ok) {
    const message = await readGoogleError(response)
    throw new Error(message)
  }

  return (await response.json()) as T
}

async function readGoogleError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    if (body.error?.message) {
      return body.error.message
    }
  } catch {
    // Fall through to status-based message.
  }

  if (response.status === 401 || response.status === 403) {
    return 'Google Drive did not allow the receipt image upload. Reconnect Google and try again.'
  }

  return `Google Drive image upload failed with HTTP ${response.status}.`
}
