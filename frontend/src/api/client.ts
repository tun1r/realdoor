import type {
  AppConfig,
  JsonScalar,
  QuestionResponse,
  SessionState,
} from '../types'

const defaultBaseUrl = 'http://localhost:8000'

export class ApiError extends Error {
  status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function getErrorMessage(status: number, payload: unknown) {
  if (typeof payload === 'object' && payload !== null) {
    const detail = (payload as { detail?: unknown }).detail
    if (typeof detail === 'string' && detail.length > 0) return detail
    const message = (payload as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }

  if (status === 0) return 'RealDoor could not reach the evidence service.'
  if (status === 404) return 'That RealDoor resource is not available.'
  return 'RealDoor could not complete that request. Try again.'
}

async function readPayload(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json() as Promise<unknown>
  }

  const text = await response.text()
  return text.length > 0 ? text : null
}

export class ApiClient {
  readonly baseUrl: string

  constructor(baseUrl = import.meta.env.VITE_API_BASE_URL || defaultBaseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init?.body instanceof FormData
            ? {}
            : { 'Content-Type': 'application/json' }),
          ...init?.headers,
        },
      })
    } catch {
      throw new ApiError(getErrorMessage(0, null))
    }

    const payload = await readPayload(response)
    if (!response.ok) {
      throw new ApiError(getErrorMessage(response.status, payload), response.status)
    }

    return payload as T
  }

  getConfig() {
    return this.request<AppConfig>('/api/config')
  }

  createSession() {
    return this.request<SessionState>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  createDemoSession(householdId: string) {
    return this.request<SessionState>(
      `/api/sessions/demo/${encodeURIComponent(householdId)}`,
      { method: 'POST' },
    )
  }

  uploadDocuments(sessionId: string, files: File[]) {
    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))

    return this.request<SessionState>(`/api/sessions/${encodeURIComponent(sessionId)}/documents`, {
      method: 'POST',
      body: formData,
    })
  }

  getSession(sessionId: string) {
    return this.request<SessionState>(`/api/sessions/${encodeURIComponent(sessionId)}`)
  }

  confirmFields(sessionId: string, fieldIds?: string[]) {
    return this.request<SessionState>(`/api/sessions/${encodeURIComponent(sessionId)}/confirm`, {
      method: 'POST',
      body: JSON.stringify(fieldIds ? { field_ids: fieldIds } : {}),
    })
  }

  patchField(sessionId: string, fieldId: string, value: JsonScalar) {
    return this.request<SessionState>(
      `/api/sessions/${encodeURIComponent(sessionId)}/fields/${encodeURIComponent(fieldId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ value, confirmed: true }),
      },
    )
  }

  askQuestion(sessionId: string, question: string) {
    return this.request<QuestionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/question`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    })
  }

  patchPacket(sessionId: string, includedDocumentIds: string[], renterNote?: string) {
    return this.request<SessionState>(`/api/sessions/${encodeURIComponent(sessionId)}/packet`, {
      method: 'PATCH',
      body: JSON.stringify({
        included_document_ids: includedDocumentIds,
        ...(renterNote === undefined ? {} : { renter_note: renterNote }),
      }),
    })
  }

  async downloadPacket(sessionId: string) {
    const response = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/packet.zip`,
    )

    if (!response.ok) {
      let payload: unknown = null
      try {
        payload = await readPayload(response)
      } catch {
        payload = null
      }
      throw new ApiError(getErrorMessage(response.status, payload), response.status)
    }

    return response.blob()
  }

  pageImageUrl(sessionId: string, documentId: string, pageNumber: number) {
    return `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/documents/${encodeURIComponent(documentId)}/page/${pageNumber}.png`
  }

  deleteSession(sessionId: string) {
    return this.request<null>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    })
  }
}

export const apiClient = new ApiClient()
