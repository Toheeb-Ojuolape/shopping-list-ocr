export interface APIErrorPayload {
  error: {
    error: string
    data: string
  }
}

export type CustomAPIError = Error & {
  response?: {
    data?: APIErrorPayload | { error?: string }
  }
}
