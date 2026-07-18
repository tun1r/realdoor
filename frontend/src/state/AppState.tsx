import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, apiClient, type ApiClient } from '../api/client'
import { AppStateContext } from './appContext'
import type { AppStateValue } from './appContext'
import type {
  ApiErrorState,
  AppConfig,
  BusyKind,
  Field,
  JsonScalar,
  QuestionResponse,
  SessionState,
  View,
} from '../types'

const sessionStorageKey = 'realdoor.activeSessionId'

function isSessionState(value: unknown): value is SessionState {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<SessionState>
  return typeof candidate.id === 'string' && Array.isArray(candidate.documents)
}

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  return 'RealDoor could not complete that request. Try again.'
}

export function AppStateProvider({
  children,
  client = apiClient,
}: {
  children: ReactNode
  client?: ApiClient
}) {
  const [view, setView] = useState<View>('welcome')
  const [session, setSession] = useState<SessionState | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [busy, setBusy] = useState<BusyKind>(null)
  const [error, setError] = useState<ApiErrorState | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  )
  const [lastQuestion, setLastQuestion] = useState<QuestionResponse | null>(null)

  useEffect(() => {
    let active = true
    void client
      .getConfig()
      .then((nextConfig) => {
        if (active) setConfig(nextConfig)
      })
      .catch(() => {
        // The screens can use the session's frozen rule values when config is unavailable.
      })

    return () => {
      active = false
    }
  }, [client])

  useEffect(() => {
    const sessionId = window.sessionStorage.getItem(sessionStorageKey)
    if (!sessionId) return
    let active = true
    void client.getSession(sessionId).then((restored) => {
      if (!active) return
      setSession(restored)
      setView('profile')
      setAnnouncement('Your active evidence desk was restored in this browser tab.')
    }).catch(() => {
      window.sessionStorage.removeItem(sessionStorageKey)
    })
    return () => {
      active = false
    }
  }, [client])

  useEffect(() => {
    if (session) window.sessionStorage.setItem(sessionStorageKey, session.id)
  }, [session])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const resolveSession = async (result: unknown, fallbackId?: string) => {
    if (isSessionState(result)) return result

    const resultId =
      typeof result === 'object' && result !== null && 'id' in result
        ? (result as { id?: unknown }).id
        : undefined
    const sessionId = typeof resultId === 'string' ? resultId : fallbackId
    if (sessionId) return client.getSession(sessionId)
    throw new ApiError('The evidence service returned an incomplete session.')
  }

  const run = async <T,>(kind: Exclude<BusyKind, null>, operation: () => Promise<T>) => {
    setBusy(kind)
    setError(null)
    try {
      return await operation()
    } catch (caughtError) {
      setError({ message: getErrorMessage(caughtError) })
      throw caughtError
    } finally {
      setBusy(null)
    }
  }

  const createBlankSession = async () => {
    try {
      const nextSession = await run('creating', async () => {
        const result = await client.createSession()
        return resolveSession(result)
      })
      setSession(nextSession)
      setLastQuestion(null)
      setView('profile')
      setAnnouncement('Blank session created. Add documents when you are ready.')
    } catch {
      // The error summary is rendered by the shell.
    }
  }

  const loadDemoSession = async (householdId: string) => {
    try {
      const nextSession = await run('loading-demo', async () => {
        const result = await client.createDemoSession(householdId)
        return resolveSession(result)
      })
      setSession(nextSession)
      setLastQuestion(null)
      setView('profile')
      setAnnouncement(`${householdId} loaded. Review each field before arithmetic.`)
    } catch {
      // The error summary is rendered by the shell.
    }
  }

  const uploadDocuments = async (files: File[]) => {
    if (files.length === 0) return

    try {
      const nextSession = await run('uploading', async () => {
        let activeSession = session
        if (!activeSession) {
          const created = await client.createSession()
          activeSession = await resolveSession(created)
        }
        const result = await client.uploadDocuments(activeSession.id, files)
        return resolveSession(result, activeSession.id)
      })
      setSession(nextSession)
      setLastQuestion(null)
      setView('profile')
      setAnnouncement('Documents uploaded. Extraction is ready for your review.')
    } catch {
      // The error summary is rendered by the shell.
    }
  }

  const confirmAllFields = async () => {
    if (!session) return
    try {
      const nextSession = await run('confirming', async () => {
        const result = await client.confirmFields(session.id)
        return resolveSession(result, session.id)
      })
      setSession(nextSession)
      setAnnouncement('All extracted fields are confirmed. Arithmetic has been refreshed.')
    } catch {
      // The error summary is rendered by the shell.
    }
  }

  const correctField = async (field: Field, value: JsonScalar) => {
    if (!session) return
    try {
      const nextSession = await run('correcting', async () => {
        const result = await client.patchField(session.id, field.id, value)
        return resolveSession(result, session.id)
      })
      setSession(nextSession)
      setAnnouncement(`${field.label} was saved as confirmed. Arithmetic has been refreshed.`)
    } catch (caughtError) {
      setError({ message: getErrorMessage(caughtError), fieldId: field.id })
      throw caughtError
    }
  }

  const askQuestion = async (question: string) => {
    if (!session || question.trim().length === 0) return
    try {
      const response = await run('question', () => client.askQuestion(session.id, question.trim()))
      setLastQuestion({ ...response, question: question.trim() })
      setAnnouncement('Rules answer loaded with its source citations.')
    } catch {
      // The error summary is rendered by the shell.
    }
  }

  const updatePacket = async (includedDocumentIds: string[], renterNote: string) => {
    if (!session) return
    try {
      const nextSession = await run('packet', async () => {
        const result = await client.patchPacket(session.id, includedDocumentIds, renterNote)
        return resolveSession(result, session.id)
      })
      setSession(nextSession)
      setAnnouncement('Packet choices saved.')
    } catch {
      // The error summary is rendered by the shell.
    }
  }

  const downloadPacket = async (includedDocumentIds: string[], renterNote: string) => {
    if (!session) return
    try {
      const blob = await run('exporting', async () => {
        const result = await client.patchPacket(session.id, includedDocumentIds, renterNote)
        const nextSession = await resolveSession(result, session.id)
        setSession(nextSession)
        return client.downloadPacket(session.id)
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `realdoor-${session.id}.zip`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setAnnouncement('Packet ZIP download started.')
    } catch {
      // The error summary is rendered by the shell.
    }
  }

  const deleteCurrentSession = async () => {
    if (!session) return
    const sessionId = session.id
    await run('deleting', () => client.deleteSession(sessionId))
    window.sessionStorage.removeItem(sessionStorageKey)
    setSession(null)
    setLastQuestion(null)
    setView('welcome')
    setAnnouncement('Session deleted. No session is open.')
  }

  const navigate = (nextView: View) => {
    if (nextView === 'welcome' || session) setView(nextView)
  }

  const value: AppStateValue = {
    view,
    session,
    config,
    busy,
    error,
    announcement,
    isOnline,
    lastQuestion,
    navigate,
    createBlankSession,
    loadDemoSession,
    uploadDocuments,
    confirmAllFields,
    correctField,
    askQuestion,
    updatePacket,
    downloadPacket,
    deleteCurrentSession,
    clearError: () => setError(null),
  }

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}
