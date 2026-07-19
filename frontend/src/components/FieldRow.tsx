import { useEffect, useState } from 'react'
import { Check, FileSearch, Pencil, Save, X } from 'lucide-react'
import type { Field, JsonScalar } from '../types'
import { formatValue, inputValue, parseInputValue, sourceLabel } from '../utils'

interface FieldRowProps {
  field: Field
  documentName: string
  busy: boolean
  hasError: boolean
  onInspect: (field: Field, opener: HTMLButtonElement) => void
  onSave: (field: Field, value: JsonScalar) => Promise<void>
  readOnly?: boolean
}

function confidenceLabel(confidence: number | null) {
  if (confidence === null || Number.isNaN(confidence)) return 'Confidence not reported'
  const percentage = confidence <= 1 ? confidence * 100 : confidence
  return `${Math.round(percentage)}% confidence`
}

export function FieldRow({ field, documentName, busy, hasError, onInspect, onSave, readOnly = false }: FieldRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(inputValue(field.confirmed ? field.confirmed_value : field.extracted_value))

  useEffect(() => {
    if (!editing) {
      setDraft(inputValue(field.confirmed ? field.confirmed_value : field.extracted_value))
    }
  }, [editing, field.confirmed, field.confirmed_value, field.extracted_value])

  const displayValue = field.confirmed ? field.confirmed_value : field.extracted_value
  const stateLabel = field.confirmed
    ? 'Confirmed by you'
    : displayValue === null || displayValue === ''
      ? 'Missing'
      : 'Needs your review'

  const save = async () => {
    try {
      await onSave(field, parseInputValue(draft, field.value_type))
      setEditing(false)
    } catch {
      // Keep the correction open so the error summary can return to this control.
    }
  }

  return (
    <article className="evidence-row" aria-busy={busy}>
      <div className="evidence-row__main">
        <div className="evidence-row__label">{field.label}</div>
        {editing ? (
          <div className="field-editor">
            <label className="sr-only" htmlFor={`edit-${field.id}`}>
              Correct {field.label}
            </label>
            <input
              id={`edit-${field.id}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-describedby={`edit-help-${field.id}`}
              aria-invalid={hasError}
              disabled={busy}
            />
            <span className="sr-only" id={`edit-help-${field.id}`}>
              Saving this value confirms it for arithmetic.
            </span>
            <button type="button" className="button button--small button--primary" onClick={() => void save()} disabled={busy}>
              <Save aria-hidden="true" size={16} />
              Save
            </button>
            <button
              type="button"
              className="icon-button icon-button--small"
              onClick={() => setEditing(false)}
              disabled={busy}
              aria-label={`Cancel correction for ${field.label}`}
              title="Cancel correction"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="field-value-button"
            onClick={(event) => onInspect(field, event.currentTarget)}
            aria-label={`Inspect ${field.label}: ${formatValue(displayValue, field.value_type)}`}
          >
            <strong>{formatValue(displayValue, field.value_type)}</strong>
            <FileSearch aria-hidden="true" size={17} />
          </button>
        )}
      </div>

      <div className="evidence-row__detail">
        <span className={`field-state ${field.confirmed ? 'field-state--confirmed' : 'field-state--review'}`}>
          {field.confirmed ? <Check aria-hidden="true" size={15} /> : null}
          {stateLabel}
        </span>
        <span className="field-method">
          {field.method} · {confidenceLabel(field.confidence)}
        </span>
      </div>

      <div className="evidence-row__actions">
        <button
          type="button"
          className="source-link"
          onClick={(event) => onInspect(field, event.currentTarget)}
          aria-label={`See source for ${field.label}, ${sourceLabel(documentName, field.page)}`}
        >
          <FileSearch aria-hidden="true" size={15} />
          {sourceLabel(documentName, field.page)}
        </button>
        {!editing && !readOnly ? (
          <button
            type="button"
            className="text-button"
            onClick={() => setEditing(true)}
            disabled={busy}
            aria-label={`Correct ${field.label}`}
          >
            <Pencil aria-hidden="true" size={15} />
            Correct
          </button>
        ) : null}
      </div>
    </article>
  )
}
