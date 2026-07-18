import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileCheck2, FileSearch, FileText, LoaderCircle, Package, Save, Trash2 } from 'lucide-react'
import { DeleteDialog } from '../components/DeleteDialog'
import { useAppState } from '../state/useAppState'
import type { Field } from '../types'

interface PrepareScreenProps {
  onInspect: (field: Field, opener: HTMLButtonElement) => void
}

const reasonDescriptions: Record<string, string> = {
  PAY_STUB_TOTAL_CONFLICT: 'A displayed gross-pay total differs from regular hours multiplied by hourly rate.',
  GIG_INCOME_UNCORROBORATED: 'Gig receipts need an independent corroborating source before handoff.',
  EMPLOYMENT_LETTER_EXPIRED: 'An employment letter falls outside the challenge simulation’s 60-day window.',
  APPLICATION_SUMMARY_EXPIRED: 'The application summary falls outside the challenge simulation’s 60-day window.',
  PAY_STUB_EXPIRED: 'A pay statement falls outside the challenge simulation’s 60-day window.',
  EMPLOYMENT_INCOME_UNCORROBORATED: 'Employment-letter wages are not corroborated by a current pay statement.',
  HOUSEHOLD_IDENTITY_CONFLICT: 'An income document names a different person from the application summary.',
  MISSING_CITATION: 'A material value has no valid page-level source box.',
  MISSING_PAY_STUB: 'No pay statement is present for the wage evidence.',
  MISSING_APPLICATION_SUMMARY: 'No application summary is present.',
  MISSING_REQUIRED_FIELD: 'A material field is unresolved or unconfirmed.',
  NO_CONFIRMED_INCOME: 'No confirmed recurring income source can be calculated.',
  NO_FROZEN_THRESHOLD: 'The household size is outside the frozen threshold table.',
}

function fieldsForReason(reason: string, fields: Field[]) {
  const names: Record<string, string[]> = {
    PAY_STUB_TOTAL_CONFLICT: ['gross_pay', 'regular_hours', 'hourly_rate'],
    GIG_INCOME_UNCORROBORATED: ['gross_receipts', 'statement_month'],
    EMPLOYMENT_LETTER_EXPIRED: ['document_date'],
    APPLICATION_SUMMARY_EXPIRED: ['application_date'],
    PAY_STUB_EXPIRED: ['pay_date'],
    EMPLOYMENT_INCOME_UNCORROBORATED: ['weekly_hours', 'hourly_rate'],
    HOUSEHOLD_IDENTITY_CONFLICT: ['person_name'],
  }
  if (reason === 'MISSING_CITATION') return fields.filter((field) => !field.bbox)
  return fields.filter((field) => names[reason]?.includes(field.name)).slice(0, 4)
}

export function PrepareScreen({ onInspect }: PrepareScreenProps) {
  const {
    session,
    busy,
    updatePacket,
    downloadPacket,
    deleteCurrentSession,
  } = useAppState()
  const [includedDocumentIds, setIncludedDocumentIds] = useState<string[]>([])
  const [renterNote, setRenterNote] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deleteTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!session) return
    setIncludedDocumentIds(session.packet.included_document_ids)
    setRenterNote(session.packet.renter_note ?? '')
  }, [session])

  if (!session) return null

  const status = session.analysis?.readiness_status ?? 'NEEDS_REVIEW'
  const reviewReasons = session.analysis?.review_reasons ?? ['Arithmetic is not available for this session yet.']
  const allFields = session.documents.flatMap((document) => document.fields)
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
        <div className={`readiness-ledger readiness-ledger--${status === 'READY_TO_REVIEW' ? 'ready' : 'review'}`}>
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
            <ul className="reason-list">
              {reviewReasons.length > 0 ? reviewReasons.map((reason, index) => {
                const fields = fieldsForReason(reason, allFields)
                return <li key={`${reason}-${index}`}>
                  <span className="reason-mark" aria-hidden="true">{index + 1}</span>
                  <span className="reason-copy">
                    <strong>{reasonDescriptions[reason] ?? 'This record needs a human evidence check before handoff.'}</strong>
                    <small className="mono">{reason}</small>
                    {fields.length > 0 ? <span className="source-traces">
                      {fields.map((field) => <button
                        type="button"
                        className="source-link"
                        key={field.id}
                        onClick={(event) => onInspect(field, event.currentTarget)}
                        aria-label={`Inspect evidence for ${reason}: ${field.label}`}
                      >
                        <FileSearch aria-hidden="true" size={15} />
                        {field.label}
                      </button>)}
                    </span> : null}
                  </span>
                </li>
              }) : <li><CheckCircle2 aria-hidden="true" size={18} /><span>No evidence gaps or conflicts were generated for this packet.</span></li>}
            </ul>
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
              {session.documents.map((document) => (
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
                {session.documents
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
