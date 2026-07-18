import { useRef } from 'react'
import { ArrowRight, FilePlus2, LoaderCircle, Upload } from 'lucide-react'
import { useAppState } from '../state/useAppState'

export function WelcomeScreen() {
  const {
    busy,
    config,
    createBlankSession,
    loadDemoSession,
    uploadDocuments,
  } = useAppState()
  const inputRef = useRef<HTMLInputElement>(null)
  const isBusy = busy !== null
  const demoHouseholds = config?.demo_households ?? []
  const demosAvailable = config?.pack_available !== false && demoHouseholds.length > 0

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    void uploadDocuments(Array.from(files))
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="welcome-layout">
      <section className="welcome-primary" aria-labelledby="welcome-title">
        <span className="eyebrow">Evidence Desk / new session</span>
        <h1 id="welcome-title">Make a renter packet you can inspect.</h1>
        <p className="welcome-lede">
          RealDoor reads paperwork into a source-linked record. You confirm every field before the arithmetic is shown.
        </p>
        <div className="welcome-actions">
          <button type="button" className="button button--primary button--large" onClick={() => void createBlankSession()} disabled={isBusy}>
            {busy === 'creating' ? <LoaderCircle className="spin" aria-hidden="true" size={19} /> : <FilePlus2 aria-hidden="true" size={19} />}
            Start a blank session
            <ArrowRight aria-hidden="true" size={18} />
          </button>
          <label className={`button button--secondary button--large ${isBusy ? 'button--disabled' : ''}`} htmlFor="pdf-upload">
            {busy === 'uploading' ? <LoaderCircle className="spin" aria-hidden="true" size={19} /> : <Upload aria-hidden="true" size={19} />}
            Upload PDFs
          </label>
          <input
            ref={inputRef}
            id="pdf-upload"
            className="sr-only"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(event) => handleFiles(event.target.files)}
            disabled={isBusy}
          />
        </div>
        <p className="microcopy">
          PDF files only. {config?.extraction_mode === 'local_plus_hosted_vision'
            ? `Local extraction runs first; unresolved pages may be sent to ${config.hosted_vision_provider ?? 'the configured hosted vision provider'}.`
            : 'Extraction stays in this RealDoor service and does not call a hosted vision provider.'}
        </p>
      </section>

      <aside className="welcome-aside" aria-labelledby="demo-title">
        <div className="aside-rule" />
        <span className="eyebrow">Practice desks</span>
        <h2 id="demo-title">Open a demo household</h2>
        <p>Use a prepared record to walk the full Profile, Understand, Prepare flow.</p>
        {demosAvailable ? <div className="demo-list">
          {demoHouseholds.map((householdId) => (
            <button
              type="button"
              className="demo-row"
              key={householdId}
              onClick={() => void loadDemoSession(householdId)}
              disabled={isBusy}
            >
              <span className="mono">{householdId}</span>
              <span>{busy === 'loading-demo' ? 'Loading' : 'Open desk'}</span>
              <ArrowRight aria-hidden="true" size={17} />
            </button>
          ))}
        </div> : (
          <p className="muted-copy">Demo fixtures appear here when the local starter pack is configured. You can still upload your own synthetic PDFs.</p>
        )}
      </aside>
    </div>
  )
}
