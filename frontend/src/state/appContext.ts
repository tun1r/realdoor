import { createContext } from 'react'
import type { ApiErrorState, AppConfig, BusyKind, Field, JsonScalar, QuestionResponse, SessionState, View } from '../types'

export interface AppStateValue {
  view: View
  session: SessionState | null
  config: AppConfig | null
  busy: BusyKind
  error: ApiErrorState | null
  announcement: string
  isOnline: boolean
  lastQuestion: QuestionResponse | null
  navigate: (view: View) => void
  createBlankSession: () => Promise<void>
  loadDemoSession: (householdId: string) => Promise<void>
  uploadDocuments: (files: File[]) => Promise<void>
  confirmAllFields: () => Promise<void>
  correctField: (field: Field, value: JsonScalar) => Promise<void>
  askQuestion: (question: string) => Promise<void>
  updatePacket: (includedDocumentIds: string[], renterNote: string) => Promise<void>
  downloadPacket: (includedDocumentIds: string[], renterNote: string) => Promise<void>
  deleteCurrentSession: () => Promise<void>
  clearError: () => void
}

export const AppStateContext = createContext<AppStateValue | null>(null)
