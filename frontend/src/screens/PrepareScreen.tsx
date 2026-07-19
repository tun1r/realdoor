import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileCheck2, FileSearch, FileText, FileUp, LoaderCircle, Package, Save, Trash2 } from 'lucide-react'
import { DeleteDialog } from '../components/DeleteDialog'
import { useAppState } from '../state/useAppState'
import type { DocumentRecord, Field, ReviewIssue } from '../types'
import { formatCurrency, formatValue } from '../utils'

interface PrepareScreenProps {
  onInspect: (field: Field, opener: HTMLButtonElement) => void
}

function ReplacementPicker({
  issue,
  document,
  disabled,
  onStage,
}: {
  issue: ReviewIssue
  document: DocumentRecord
  disabled: boolean
  onStage: (activeDocumentId: string, file: File, trigger: HTMLButtonElement) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputId = `replacement-${issue.issue_id}`

  const restoreTrigger = () => triggerRef.current?.focus()

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.addEventListener('cancel', restoreTrigger)
    return () => input.removeEventListener('cancel', restoreTrigger)
  }, [])

  return (
    <span className="replacement-picker">
      <button
        ref={triggerRef}
        type="button"
        className="button button--small button--secondary"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <FileUp aria-hidden="true" size={16} />
        Replace document
      </button>
      <label className="sr-only" htmlFor={inputId}>Choose a replacement PDF for {document.file_name}</label>
      <input
        ref={inputRef}
        id={inputId}
        className="sr-only"
        type="file"
        accept="application/pdf,.pdf"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          const trigger = triggerRef.current
          if (!file || !trigger) {
            restoreTrigger()
            return
          }
          void onStage(document.id, file, trigger).finally(() => {
            if (inputRef.current) inputRef.current.value = ''
          })
        }}
      />
    </span>
  )
}

export function PrepareScreen({ onInspect }: PrepareScreenProps) {
  const {
    session,
    busy,
    updatePacket,
    downloadPacket,
    deleteCurrentSession,
    stageReplacement,
    focusIntent,
    clearFocusIntent,
  } = useAppState()
  const [includedDocumentIds, setIncludedDocumentIds] = useState<string[]>([])
  const [renterNote, setRenterNote] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deleteTriggerRef = useRef<HTMLButtonElement>(null)
  const readinessRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!session) return
    setIncludedDocumentIds(session.packet.included_document_ids)
    setRenterNote(session.packet.renter_note ?? '')
  }, [session])

  useEffect(() => {
    if (focusIntent?.type !== 'readiness-result') return
    readinessRef.current?.focus()
    clearFocusIntent()
  }, [clearFocusIntent, focusIntent])

  if (!session) return null

  const status = session.analysis?.readiness_status ?? 'NEEDS_REVIEW'
  const reviewIssues = session.analysis?.review_issues ?? []
  const fieldsById = new Map(session.documents.flatMap((document) => document.fields).map((field) => [field.id, field]))
  const activeDocuments = session.documents.filter((document) => document.status === 'active')
  const documentsById = new Map(session.documents.map((document) => [document.id, document]))
  const omittedDocuments = activeDocuments.filter((document) => !includedDocumentIds.includes(document.id))
  const packetComplete = activeDocuments.length > 0 && omittedDocuments.length === 0
  const packetExportReady = packetComplete && session.analysis !== null
  const isBusy = busy !== null

  const closeDelete = () => {
    setDeleteOpen(false)
    deleteTriggerRef.current?.focus()
  }

  return (
    <div className="screen-stack">
      <header className="screen-heading">
        <div>
          <span className="eyebrow">Step 03 / packet desk</span>
          <h1>Prepare</h1>
          <p>Choose the documents and context a human reviewer should receive. Nothing is sent automatically.</p>
        </div>
        <div
          ref={readinessRef}
          className={`readiness-ledger readiness-ledger--${status === 'READY_TO_REVIEW' ? 'ready' : 'review'}`}
          tabIndex={-1}
          aria-label={`Readiness result: ${status}`}
        >
          {status === 'READY_TO_REVIEW' ? <CheckCircle2 aria-hidden="true" size={20} /> : <AlertTriangle aria-hidden="true" size={20} />}
          <span>
            <small>Readiness ledger</small>
            <strong>{status}</strong>
          </span>
        </div>
      </header>

      <div className="prepare-layout">
        <section className="prepare-main">
          <section className="reason-section" aria-labelledby="reasons-title">
            <div className="section-heading-row">
              <div>
                <span className="eyebrow">Review ledger</span>
                <h2 id="reasons-title">Explicit review reasons</h2>
              </div>
              <FileCheck2 aria-hidden="true" size={21} />
            </div>
            {session.analysis ? (
              <dl className="prepare-analysis-summary" aria-label="Canonical analysis summary">
                <div>
                  <dt>Annualized income</dt>
                  <dd>{formatCurrency(session.analysis.annualized_income)}</dd>
                </div>
                <div>
                  <dt>Frozen threshold</dt>
                  <dd>{formatCurrency(session.analysis.threshold)}</dd>
                </div>
              </dl>
            ) : null}
            <ul className="reason-list">
              {reviewIssues.length > 0 ? reviewIssues.map((issue, index) => {
                const fields = issue.affected_field_ids
                  .map((fieldId) => fieldsById.get(fieldId))
                  .filter((field): field is Field => Boolean(field))
                const actionDocument = issue.action.document_id
                  ? documentsById.get(issue.action.document_id)
                  : undefined
                return <li key={issue.issue_id}>
                  <span className="reason-mark" aria-hidden="true">{index + 1}</span>
                  <span className="reason-copy">
                    <strong>{issue.message}</strong>
                    <small className="mono">{issue.code}</small>
                    {fields.map((field) => (
                      <span className="issue-citation" key={field.id}>
                        <span><strong>{field.label}:</strong> {formatValue(field.confirmed ? field.confirmed_value : field.extracted_value, field.value_type)}</span>
                        <button
                          type="button"
                          className="source-link"
                          onClick={(event) => onInspect(field, event.currentTarget)}
                          aria-label={`View source for ${field.label} in ${documentsById.get(field.document_id)?.file_name ?? field.document_id}, issue ${issue.code}`}
                        >
                          <FileSearch aria-hidden="true" size={15} />
                          View source
                        </button>
                      </span>
                    ))}
                    {issue.action.type === 'replace_document' && actionDocument?.status === 'active' ? (
                      <ReplacementPicker
                        issue={issue}
                        document={actionDocument}
                        disabled={isBusy}
                        onStage={stageReplacement}
                      />
                    ) : null}
                  </span>
                </li>
              }) : <li><CheckCircle2 aria-hidden="true" size={18} /><span>{session.analysis ? 'No active review issues.' : 'Review issues are unavailable until active fields are confirmed.'}</span></li>}
            </ul>
            {session.analysis?.decision_boundary ? <p className="decision-boundary">{session.analysis.decision_boundary}</p> : null}
          </section>

          <section className="packet-options" aria-labelledby="documents-title">
            <div className="section-heading-row">
              <div>
                <span className="eyebrow">Packet contents</span>
                <h2 id="documents-title">Documents to include</h2>
              </div>
              <span className="mono">{includedDocumentIds.length} selected</span>
            </div>
            <div className="document-checkboxes">
              {activeDocuments.map((document) => (
                <label className="document-checkbox" key={document.id}>
                  <input
                    type="checkbox"
                    checked={includedDocumentIds.includes(document.id)}
                    onChange={(event) => {
                      setIncludedDocumentIds((current) =>
                        event.target.checked
                          ? [...current, document.id]
                          : current.filter((id) => id !== document.id),
                      )
                    }}
                    disabled={isBusy}
                  />
                  <span className="checkbox-copy">
                    <strong>{document.file_name}</strong>
                    <small>{document.document_type} · {document.page_count} pages</small>
                  </span>
                  <FileText aria-hidden="true" size={19} />
                </label>
              ))}
            </div>
            <div
              className={packetComplete ? 'sr-only' : 'packet-incomplete-warning'}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label="Packet completeness"
            >
              {packetExportReady ? (
                <span>Complete packet. All active documents are selected. submission.json will be included.</span>
              ) : (
                <>
                  <AlertTriangle aria-hidden="true" size={20} />
                  <div>
                    <strong>{packetComplete ? 'Packet is waiting for confirmed evidence' : 'Incomplete packet'}</strong>
                    {omittedDocuments.length > 0 ? <>
                      <p>Omitted active documents:</p>
                      <ul>
                        {omittedDocuments.map((document) => <li key={document.id}>{document.file_name}</li>)}
                      </ul>
                    </> : null}
                    <p>No submission.json will be included{packetComplete ? ' until active evidence is confirmed' : ''}. Canonical readiness remains unchanged.</p>
                  </div>
                </>
              )}
            </div>
            <div className="note-editor">
              <label htmlFor="renter-note">Renter note</label>
              <textarea
                id="renter-note"
                rows={5}
                value={renterNote}
                onChange={(event) => setRenterNote(event.target.value)}
                placeholder="Add context a reviewer should read alongside the documents."
                disabled={isBusy}
              />
              <button type="button" className="button button--secondary" onClick={() => void updatePacket(includedDocumentIds, renterNote)} disabled={isBusy}>
                {busy === 'packet' ? <LoaderCircle className="spin" aria-hidden="true" size={17} /> : <Save aria-hidden="true" size={17} />}
                Save packet choices
              </button>
            </div>
          </section>
        </section>

        <aside className="prepare-support" aria-label="Packet support">
          <section className="packet-preview paper-surface" aria-labelledby="preview-title">
            <div className="section-kicker">
              <Package aria-hidden="true" size={17} />
              Packet preview
            </div>
            <h2 id="preview-title">Preview your review packet</h2>
            <div className="preview-rule" />
            {includedDocumentIds.length > 0 ? (
              <ol className="preview-documents">
                {activeDocuments
                  .filter((document) => includedDocumentIds.includes(document.id))
                  .map((document) => (
                    <li key={document.id}>
                      <span className="mono">{String(document.page_count).padStart(2, '0')}</span>
                      <span>{document.file_name}</span>
                    </li>
                  ))}
              </ol>
            ) : (
              <p className="muted-copy">Choose at least one document for the preview.</p>
            )}
            <div className="preview-note">
              <span className="meta-label">Renter note</span>
              <p>{renterNote || 'No note added.'}</p>
            </div>
            <button type="button" className="button button--primary button--full" onClick={() => void downloadPacket(includedDocumentIds, renterNote)} disabled={isBusy || includedDocumentIds.length === 0}>
              {busy === 'exporting' ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Package aria-hidden="true" size={18} />}
              Download packet (.zip)
            </button>
            <p className="microcopy">This downloads a ZIP to your device. RealDoor does not send it automatically.</p>
          </section>

          <section className="delete-section" aria-labelledby="delete-section-title">
            <span className="eyebrow">Session controls</span>
            <h2 id="delete-section-title">Delete this session</h2>
            <p>Remove the record, documents, corrections, and packet choices from RealDoor.</p>
            <button ref={deleteTriggerRef} type="button" className="button button--danger-outline" onClick={() => setDeleteOpen(true)} disabled={isBusy}>
              <Trash2 aria-hidden="true" size={18} />
              Delete session
            </button>
          </section>
        </aside>
      </div>

      {deleteOpen ? <DeleteDialog onClose={closeDelete} onConfirm={deleteCurrentSession} /> : null}
    </div>
  )
}
