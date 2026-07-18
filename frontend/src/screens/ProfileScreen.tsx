import { useRef } from 'react'
import { AlertTriangle, CheckCheck, FilePlus2, LoaderCircle, Upload } from 'lucide-react'
import type { Field } from '../types'
import { useAppState } from '../state/useAppState'
import { FieldRow } from '../components/FieldRow'

interface ProfileScreenProps {
  onInspect: (field: Field, opener: HTMLButtonElement) => void
}

export function ProfileScreen({ onInspect }: ProfileScreenProps) {
  const { session, busy, error, uploadDocuments, confirmAllFields, correctField } = useAppState()
  const inputRef = useRef<HTMLInputElement>(null)

  if (!session) return null

  const fieldCount = session.documents.reduce((total, document) => total + document.fields.length, 0)
  const pendingCount = session.documents.reduce(
    (total, document) => total + document.fields.filter((field) => !field.confirmed).length,
    0,
  )
  const isBusy = busy !== null

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
          {session.documents.map((document) => (
            <section className="document-section" key={document.id} aria-labelledby={`document-${document.id}`}>
              <div className="document-heading">
                <div>
                  <span className="eyebrow">{document.document_type}</span>
                  <h2 id={`document-${document.id}`}>{document.file_name}</h2>
                </div>
                <span className="mono document-page-count">{document.page_count} pages</span>
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
                    />
                  ))}
                </div>
              ) : (
                <p className="empty-inline">No fields were extracted from this document.</p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
