import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { AlertCircle, BookOpen, CloudOff, FileText, PackageCheck, UserRound, X } from 'lucide-react'
import { useAppState } from '../state/useAppState'
import type { View } from '../types'

interface AppShellProps {
  children: ReactNode
}

const steps: Array<{ view: View; label: string; caption: string; icon: typeof UserRound }> = [
  { view: 'profile', label: 'Profile', caption: 'Review evidence', icon: UserRound },
  { view: 'understand', label: 'Understand', caption: 'Read arithmetic', icon: BookOpen },
  { view: 'prepare', label: 'Prepare', caption: 'Build packet', icon: PackageCheck },
]

function busyLabel(busy: ReturnType<typeof useAppState>['busy']) {
  switch (busy) {
    case 'creating':
      return 'Creating session'
    case 'loading-demo':
      return 'Loading demo household'
    case 'uploading':
      return 'Extracting document fields'
    case 'replacement-uploading':
      return 'Uploading replacement'
    case 'replacement-extracting':
      return 'Extracting and validating replacement evidence'
    case 'confirming':
      return 'Confirming fields'
    case 'confirming-replacement':
      return 'Confirming replacement evidence'
    case 'correcting':
      return 'Saving correction'
    case 'question':
      return 'Reading rule sources'
    case 'packet':
      return 'Saving packet choices'
    case 'exporting':
      return 'Preparing ZIP download'
    case 'deleting':
      return 'Deleting session'
    default:
      return ''
  }
}

export function AppShell({ children }: AppShellProps) {
  const { view, session, busy, error, announcement, focusIntent, isOnline, navigate, clearError, clearFocusIntent } = useAppState()
  const errorRef = useRef<HTMLDivElement>(null)
  const statusText = busyLabel(busy)

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  useEffect(() => {
    if (focusIntent?.type !== 'replacement-trigger') return
    focusIntent.trigger.focus()
    clearFocusIntent()
  }, [clearFocusIntent, focusIntent])

  const nav = (nextView: View) => {
    if (!session && nextView !== 'welcome') return
    navigate(nextView)
  }

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="app-frame">
      <aside className="process-rail" aria-label="Process navigation">
        <div className="brand-lockup" aria-label="RealDoor home">
          <span className="brand-real">Real</span>
          <span className="brand-door">Door</span>
        </div>
        <div className="rail-rule" />
        <p className="rail-label">Your process</p>
        <nav aria-label="Evidence desk steps">
          <ol className="process-steps">
            {steps.map(({ view: stepView, label, caption, icon: Icon }, index) => (
              <li key={stepView}>
                <button
                  type="button"
                  className={`process-step ${view === stepView ? 'process-step--active' : ''} ${!session ? 'process-step--disabled' : ''}`}
                  onClick={() => nav(stepView)}
                  disabled={!session}
                  aria-current={view === stepView ? 'step' : undefined}
                >
                  <span className="process-step__number mono">0{index + 1}</span>
                  <Icon aria-hidden="true" size={19} />
                  <span>
                    <strong>{label}</strong>
                    <small>{caption}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="rail-footer">
          <FileText aria-hidden="true" size={18} />
          <p>Every value keeps its source.</p>
        </div>
      </aside>

      <div className="app-body">
        <header className="top-bar">
          <div className="top-bar__identity">
            <div className="mobile-brand" aria-label="RealDoor home">
              <span className="brand-real">Real</span>
              <span className="brand-door">Door</span>
            </div>
            <span className="top-bar__context">Evidence Desk</span>
          </div>
          <nav className="mobile-process-nav" aria-label="Mobile evidence desk steps">
            {steps.map(({ view: stepView, label, icon: Icon }) => (
              <button
                type="button"
                key={stepView}
                className={view === stepView ? 'mobile-nav-button mobile-nav-button--active' : 'mobile-nav-button'}
                onClick={() => nav(stepView)}
                disabled={!session}
                aria-current={view === stepView ? 'step' : undefined}
              >
                <Icon aria-hidden="true" size={18} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="top-bar__meta">
            {!isOnline ? (
              <span className="offline-marker">
                <CloudOff aria-hidden="true" size={16} />
                Offline
              </span>
            ) : null}
            {statusText ? <span className="busy-marker">{statusText}</span> : null}
            {session ? <span className="mono session-id">{session.id.slice(0, 8)}</span> : null}
          </div>
        </header>

        {!isOnline ? (
          <div className="offline-banner" role="status">
            <CloudOff aria-hidden="true" size={19} />
            <span>You are offline. Existing evidence remains readable, but changes need a connection.</span>
          </div>
        ) : null}

        {error ? (
          <div ref={errorRef} className="error-summary" id="error-summary" role="alert" tabIndex={-1}>
            <AlertCircle aria-hidden="true" size={20} />
            <div>
              <h2>There was a problem</h2>
              <p>{error.message}</p>
              {error.fieldId ? <a href={`#edit-${error.fieldId}`}>Return to the field</a> : null}
            </div>
            <button type="button" className="icon-button icon-button--small" onClick={clearError} aria-label="Dismiss error" title="Dismiss error">
              <X aria-hidden="true" size={18} />
            </button>
          </div>
        ) : null}

        <main id="main-content" className="main-content" tabIndex={-1} aria-busy={busy !== null}>
          {children}
        </main>

        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </div>
      </div>
    </>
  )
}
