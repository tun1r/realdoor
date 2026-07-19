import { useRef, useState } from 'react'
import type { ApiClient } from './api/client'
import { apiClient } from './api/client'
import { AppShell } from './components/AppShell'
import { ProvenanceDrawer } from './components/ProvenanceDrawer'
import { PrepareScreen } from './screens/PrepareScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { UnderstandScreen } from './screens/UnderstandScreen'
import { WelcomeScreen } from './screens/WelcomeScreen'
import { AppStateProvider } from './state/AppState'
import { useAppState } from './state/useAppState'
import type { Field } from './types'

function AppContent({ client }: { client: ApiClient }) {
  const { view, session, config } = useAppState()
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const openerRef = useRef<HTMLButtonElement | null>(null)

  const inspectField = (field: Field, opener: HTMLButtonElement) => {
    openerRef.current = opener
    setSelectedFieldId(field.id)
  }

  const closeInspector = () => {
    const opener = openerRef.current
    openerRef.current = null
    setSelectedFieldId(null)
    opener?.focus()
  }

  const selectedField = session && selectedFieldId
    ? session.documents.flatMap((document) => document.fields).find((field) => field.id === selectedFieldId) ?? null
    : null
  const linkedIssue = selectedField
    ? session?.analysis?.review_issues.find((issue) => issue.affected_field_ids.includes(selectedField.id))
      ?? session?.replacement_events
        .flatMap((event) => event.resolved_issues)
        .find((issue) => issue.affected_field_ids.includes(selectedField.id))
    : null
  const ruleId = linkedIssue?.rule_ids[0] ?? null
  const citations = session?.analysis?.rule_citations ?? config?.rule_citations ?? []
  const citation = ruleId ? citations.find((item) => item.rule_id === ruleId) ?? null : null

  let screen = <WelcomeScreen />
  if (view === 'profile' && session) screen = <ProfileScreen onInspect={inspectField} />
  if (view === 'understand' && session) screen = <UnderstandScreen onInspect={inspectField} />
  if (view === 'prepare' && session) screen = <PrepareScreen onInspect={inspectField} />

  return (
    <AppShell>
      {screen}
      {selectedField && session ? (
        <ProvenanceDrawer
          field={selectedField}
          session={session}
          config={config}
          citation={citation}
          onClose={closeInspector}
          pageImageUrl={client.pageImageUrl(session.id, selectedField.document_id, selectedField.page ?? 1)}
        />
      ) : null}
    </AppShell>
  )
}

function App({ client = apiClient }: { client?: ApiClient }) {
  return (
    <AppStateProvider client={client}>
      <AppContent client={client} />
    </AppStateProvider>
  )
}

export default App
