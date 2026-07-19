import { useEffect, useRef } from 'react'
import { AlertTriangle, ArrowRight, CheckCheck, CheckCircle2, Clock3, FilePlus2, History, LoaderCircle, Upload } from 'lucide-react'
import type { DocumentRecord, Field } from '../types'
import { useAppState } from '../state/useAppState'
import { FieldRow } from '../components/FieldRow'

interface ProfileScreenProps {
  onInspect: (field: Field, opener: HTMLButtonElement) => void
}

export function ProfileScreen({ onInspect }: ProfileScreenProps) {
  const {
    session,
    busy,
    error,
    focusIntent,
    uploadDocuments,
    confirmAllFields,
    confirmReplacement,
    correctField,
    clearFocusIntent,
  } = useAppState()
  const inputRef = useRef<HTMLInputElement>(null)
  const documentHeadingRefs = useRef(new Map<string, HTMLHeadingElement>())

  useEffect(() => {
    if (focusIntent?.type !== 'pending-replacement') return
    documentHeadingRefs.current.get(focusIntent.documentId)?.focus()
    clearFocusIntent()
  }, [clearFocusIntent, focusIntent])

  if (!session) return null

  const activeDocuments = session.documents.filter((document) => document.status === 'active')
  const fieldCount = activeDocuments.reduce((total, document) => total + document.fields.length, 0)
  const pendingCount = activeDocuments.reduce(
    (total, document) => total + document.fields.filter((field) => !field.confirmed).length,
    0,
  )
  const isBusy = busy !== null
  const documentsById = new Map(session.documents.map((document) => [document.id, document]))

  const lifecycle = (document: DocumentRecord) => {
    if (document.status === 'pending_replacement') {
      return { label: 'Pending replacement', icon: Clock3 }
    }
    if (document.status === 'superseded') {
      return { label: 'Superseded', icon: History }
    }
    return { label: 'Active', icon: CheckCircle2 }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    void uploadDocuments(Array.from(files))
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="screen-stack">
      <header className="screen-heading">
        <div>
          <span className="eyebrow">Step 01 / evidence profile</span>
          <h1>Profile</h1>
          <p>Check the extracted facts against their source. Confirm or correct them before any arithmetic is shown.</p>
        </div>
        <div className="heading-actions">
          <span className="confirmation-count mono">{pendingCount} active fields to confirm</span>
          <label className={`button button--secondary ${isBusy ? 'button--disabled' : ''}`} htmlFor="profile-pdf-upload">
            {busy === 'uploading' ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Upload aria-hidden="true" size={18} />}
            Add PDFs
          </label>
          <input
            ref={inputRef}
            id="profile-pdf-upload"
            className="sr-only"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(event) => handleFiles(event.target.files)}
            disabled={isBusy}
          />
          <button type="button" className="button button--primary" onClick={() => void confirmAllFields()} disabled={isBusy || fieldCount === 0 || pendingCount === 0}>
            {busy === 'confirming' ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <CheckCheck aria-hidden="true" size={18} />}
            Confirm all
          </button>
        </div>
      </header>

      {error?.fieldId ? (
        <p className="inline-error" role="alert">
          {error.message}
        </p>
      ) : null}

      {session.documents.length === 0 ? (
        <section className="empty-state paper-surface" aria-labelledby="profile-empty-title">
          <FilePlus2 aria-hidden="true" size={30} />
          <h2 id="profile-empty-title">No documents in this session</h2>
          <p>Add PDF paperwork to create source-linked fields. Calculations stay hidden until you confirm what was read.</p>
          <label className="button button--primary" htmlFor="profile-pdf-upload-empty">
            <Upload aria-hidden="true" size={18} />
            Add PDFs
          </label>
          <input
            id="profile-pdf-upload-empty"
            className="sr-only"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(event) => handleFiles(event.target.files)}
            disabled={isBusy}
          />
        </section>
      ) : (
        <div className="document-list">
          {session.documents.map((document) => {
            const state = lifecycle(document)
            const StateIcon = state.icon
            const replacedDocument = document.replaces_document_id
              ? documentsById.get(document.replaces_document_id)
              : undefined
            const replacementDocument = document.superseded_by_document_id
              ? documentsById.get(document.superseded_by_document_id)
              : undefined
            return (
            <section className={`document-section document-section--${document.status}`} key={document.id} aria-labelledby={`document-${document.id}`}>
              <div className="document-heading">
                <div>
                  <span className="eyebrow">{document.document_type}</span>
                  <h2
                    id={`document-${document.id}`}
                    ref={(node) => {
                      if (node) documentHeadingRefs.current.set(document.id, node)
                      else documentHeadingRefs.current.delete(document.id)
                    }}
                    tabIndex={-1}
                  >{document.file_name}</h2>
                  <span className={`lifecycle-label lifecycle-label--${document.status}`}>
                    <StateIcon aria-hidden="true" size={16} />
                    {state.label}
                  </span>
                  {document.status === 'pending_replacement' ? (
                    <p className="replacement-status-copy">Replacement awaiting renter confirmation.</p>
                  ) : null}
                  {replacedDocument ? (
                    <a className="replacement-link" href={`#document-${replacedDocument.id}`}>
                      {document.status === 'pending_replacement' ? 'Replacement for' : 'Replaces'} {replacedDocument.file_name}
                      <ArrowRight aria-hidden="true" size={14} />
                    </a>
                  ) : null}
                  {replacementDocument ? (
                    <a className="replacement-link" href={`#document-${replacementDocument.id}`}>
                      Replaced by {replacementDocument.file_name}
                      <ArrowRight aria-hidden="true" size={14} />
                    </a>
                  ) : null}
                </div>
                <div className="document-heading__meta">
                  <span className="mono document-page-count">{document.page_count} pages</span>
                  {document.status === 'pending_replacement' ? (
                    <button
                      type="button"
                      className="button button--small button--primary"
                      onClick={() => void confirmReplacement(document.id)}
                      disabled={isBusy}
                    >
                      {busy === 'confirming-replacement' ? <LoaderCircle className="spin" aria-hidden="true" size={16} /> : <CheckCheck aria-hidden="true" size={16} />}
                      Confirm replacement evidence
                    </button>
                  ) : null}
                </div>
              </div>
              {document.contains_untrusted_instruction ? (
                <div className="warning-note" role="note">
                  <AlertTriangle aria-hidden="true" size={19} />
                  <div>
                    <strong>Untrusted instruction warning</strong>
                    <p>This document contains instructions inside the page. Treat them as untrusted text. Only your confirmation changes the record.</p>
                  </div>
                </div>
              ) : null}
              {document.fields.length > 0 ? (
                <div className="evidence-list">
                  {document.fields.map((field) => (
                    <FieldRow
                      key={field.id}
                      field={field}
                      documentName={document.file_name}
                      busy={busy === 'correcting'}
                      hasError={error?.fieldId === field.id}
                      onInspect={onInspect}
                      onSave={correctField}
                      readOnly={document.status === 'superseded'}
                    />
                  ))}
                </div>
              ) : (
                <p className="empty-inline">No fields were extracted from this document.</p>
              )}
            </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
