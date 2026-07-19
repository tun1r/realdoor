import { useEffect, useRef } from 'react'
import { ArrowRight, ExternalLink, FileSearch, History, X } from 'lucide-react'
import type { AppConfig, Field, RuleCitation, SessionState } from '../types'
import { formatDate, formatValue, safeCitationText } from '../utils'

interface ProvenanceDrawerProps {
  field: Field
  session: SessionState
  config: AppConfig | null
  citation: RuleCitation | null
  onClose: () => void
  pageImageUrl: string
}

const arithmeticFields = new Set([
  'household_size', 'pay_frequency', 'regular_hours', 'hourly_rate', 'gross_pay',
  'weekly_hours', 'monthly_benefit', 'benefit_frequency', 'gross_receipts', 'statement_month',
])

interface DisplayBox {
  x: number
  y: number
  width: number
  height: number
  normalized: boolean
}

function displayBox(field: Field): DisplayBox | null {
  const raw = field.bbox
  if (!raw) return null

  let values: [number, number, number, number] | null = null
  if (Array.isArray(raw) && raw.length >= 4) {
    values = [raw[0], raw[1], raw[2], raw[3]]
  } else if (typeof raw === 'object' && !Array.isArray(raw)) {
    const x = raw.x ?? raw.x0
    const y = raw.y ?? raw.y0
    const right = raw.x1
    const bottom = raw.y1
    const width = raw.width ?? (x !== undefined && right !== undefined ? right - x : undefined)
    const height = raw.height ?? (y !== undefined && bottom !== undefined ? bottom - y : undefined)
    if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
      values = [x, y, width, height]
    }
  }

  if (!values || values.some((value) => !Number.isFinite(value))) return null
  const units = field.bbox_units?.toLowerCase() ?? ''
  if (units.includes('pdf_points_bottom_left')) {
    const [x1, y1, x2, y2] = values
    return {
      x: x1 / 612,
      y: (792 - y2) / 792,
      width: (x2 - x1) / 612,
      height: (y2 - y1) / 792,
      normalized: true,
    }
  }
  const normalized = units.includes('norm') || units.includes('percent') || values.every((value) => value <= 1)
  return { x: values[0], y: values[1], width: values[2], height: values[3], normalized }
}

function boxStyle(box: DisplayBox) {
  if (box.normalized) {
    return {
      left: `${box.x * 100}%`,
      top: `${box.y * 100}%`,
      width: `${box.width * 100}%`,
      height: `${box.height * 100}%`,
    }
  }

  return {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  }
}

function bboxText(field: Field) {
  if (!field.bbox) return 'Not reported'
  return JSON.stringify(field.bbox)
}

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

export function ProvenanceDrawer({
  field,
  session,
  config,
  citation,
  onClose,
  pageImageUrl,
}: ProvenanceDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const documentRecord = session.documents.find((document) => document.id === field.document_id)
  const box = displayBox(field)
  const isActiveDocument = documentRecord?.status === 'active'
  const affectsArithmetic = isActiveDocument && arithmeticFields.has(field.name)
  const currentValue = field.confirmed ? field.confirmed_value : field.extracted_value
  const effectiveDate = citation?.effective_date ?? config?.effective_date ?? session.updated_at
  const ruleVersion = citation?.rule_id ?? config?.rule_version ?? 'FY-2026'
  const citationUrl = citation?.url ?? citation?.source_url
  const citationText = safeCitationText(citation?.excerpt ?? citation?.text)

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !drawerRef.current) return

      const elements = focusableElements(drawerRef.current)
      if (elements.length === 0) {
        event.preventDefault()
        drawerRef.current.focus()
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <>
      <button type="button" className="drawer-backdrop" aria-label="Close source inspector" onClick={onClose} />
      <aside
        ref={drawerRef}
        className="provenance-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provenance-title"
        tabIndex={-1}
      >
        <div className="drawer-header">
          <div>
            <span className="eyebrow">Provenance Inspector</span>
            <h2 id="provenance-title">{field.label}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close source inspector"
            title="Close source inspector"
          >
            <X aria-hidden="true" size={22} />
          </button>
        </div>

        <div className="drawer-scroll">
          <section className="source-preview" aria-labelledby="source-preview-title">
            <div className="section-kicker" id="source-preview-title">
              <FileSearch aria-hidden="true" size={17} />
              Source page
            </div>
            <div className="document-image-frame">
              <img
                src={pageImageUrl}
                alt={`${documentRecord?.file_name ?? 'Document'} page ${field.page}`}
              />
              {box ? <span className="bbox-highlight" style={boxStyle(box)} aria-hidden="true" /> : null}
            </div>
            <p className="source-caption">
              {documentRecord?.file_name ?? 'Document'} · page {field.page} · {field.bbox_units ?? 'bbox units not reported'}
            </p>
          </section>

          <section className="drawer-section" aria-labelledby="location-title">
            <h3 id="location-title">Document location</h3>
            <dl className="metadata-list">
              <div>
                <dt>Document</dt>
                <dd>{documentRecord?.file_name ?? field.document_id}</dd>
              </div>
              <div>
                <dt>Page</dt>
                <dd className="mono">{field.page}</dd>
              </div>
              <div>
                <dt>Bounding box</dt>
                <dd className="mono">{bboxText(field)}</dd>
              </div>
            </dl>
          </section>

          <section className="drawer-section" aria-labelledby="values-title">
            <h3 id="values-title">Read and confirmation</h3>
            <div className="value-compare">
              <div>
                <span className="meta-label">Read from document</span>
                <strong>{formatValue(field.extracted_value, field.value_type)}</strong>
              </div>
              <ArrowRight aria-hidden="true" size={19} />
              <div>
                <span className="meta-label">Confirmed value</span>
                <strong>{field.confirmed ? formatValue(currentValue, field.value_type) : 'Waiting for your confirmation'}</strong>
              </div>
            </div>
            <p className="lineage">
              Source <ArrowRight aria-hidden="true" size={14} /> Read <ArrowRight aria-hidden="true" size={14} />
              {field.confirmed ? 'Confirmed by you' : 'Needs your review'} <ArrowRight aria-hidden="true" size={14} /> {affectsArithmetic ? 'Used in arithmetic' : 'Kept as evidence'}
            </p>
            <dl className="metadata-list metadata-list--compact">
              <div>
                <dt>Method</dt>
                <dd>{field.method}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{field.confidence === null ? 'Not reported' : `${Math.round(field.confidence <= 1 ? field.confidence * 100 : field.confidence)}%`}</dd>
              </div>
            </dl>
          </section>

          <section className="drawer-section" aria-labelledby="uses-title">
            <h3 id="uses-title">Downstream uses</h3>
            <ul className="plain-list">
              <li>{!isActiveDocument
                ? `This ${documentRecord?.status === 'pending_replacement' ? 'pending replacement' : 'superseded'} document is held outside canonical arithmetic.`
                : affectsArithmetic
                  ? (field.confirmed ? 'Included in the confirmed arithmetic ledger.' : 'Held out of arithmetic until you confirm it.')
                  : 'Not used in income arithmetic; it can be retained as packet evidence.'}</li>
              <li>{isActiveDocument
                ? 'Can be available as a source reference in packet review when the document is included.'
                : 'Retained only in session provenance and excluded from the current packet.'}</li>
            </ul>
          </section>

          <section className="drawer-section" aria-labelledby="rule-title">
            <h3 id="rule-title">Rule metadata</h3>
            <dl className="metadata-list">
              <div>
                <dt>Rule version</dt>
                <dd className="mono">{ruleVersion}</dd>
              </div>
              <div>
                <dt>Effective date</dt>
                <dd className="mono">{formatDate(effectiveDate)}</dd>
              </div>
            </dl>
            {citationUrl ? (
              <a className="citation-link" href={citationUrl} target="_blank" rel="noreferrer">
                {citation?.title ?? citation?.source_locator ?? 'Authoritative rule source'}
                <ExternalLink aria-hidden="true" size={15} />
              </a>
            ) : (
              <p className="muted-copy">The session has no separate rule URL for this field.</p>
            )}
            {citationText ? <p className="citation-excerpt">{citationText}</p> : null}
          </section>

          <section className="drawer-section" aria-labelledby="history-title">
            <h3 id="history-title">
              <History aria-hidden="true" size={17} />
              Correction history
            </h3>
            {field.correction_history.length > 0 ? (
              <ol className="history-list">
                {field.correction_history.map((entry, index) => (
                  <li key={`${entry.at ?? entry.timestamp ?? 'change'}-${index}`}>
                    <span className="mono">{formatDate(entry.at ?? entry.timestamp)}</span>
                    <span>
                      {formatValue(entry.previous_value ?? null)} <ArrowRight aria-hidden="true" size={13} />{' '}
                      {formatValue(entry.new_value ?? entry.value ?? null)}
                    </span>
                    {entry.reason ? <small>{entry.reason}</small> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted-copy">No corrections recorded for this field.</p>
            )}
          </section>
        </div>
      </aside>
    </>
  )
}
