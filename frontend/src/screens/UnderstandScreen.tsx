import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, BookOpen, Calculator, CircleHelp, ExternalLink, FileSearch, LoaderCircle, LockKeyhole, MessageCircle } from 'lucide-react'
import type { Field, IncomeSource, RuleCitation } from '../types'
import { useAppState } from '../state/useAppState'
import { findField, formatCurrency, formatDate, safeCitationText } from '../utils'

interface UnderstandScreenProps {
  onInspect: (field: Field, opener: HTMLButtonElement) => void
}

const quickPrompts = [
  'What income is included in the annualized figure?',
  'How is the arithmetic calculated?',
  'What date anchors the FY 2026 reference?',
  'What can I challenge about a source?',
]

function citationName(citation: RuleCitation, index: number) {
  return citation.title ?? citation.source_locator ?? citation.rule_id ?? citation.id ?? `Rule source ${index + 1}`
}

function sourceAmount(source: IncomeSource) {
  return source.annualized_amount ?? source.amount ?? null
}

export function UnderstandScreen({ onInspect }: UnderstandScreenProps) {
  const { session, config, busy, lastQuestion, askQuestion, navigate } = useAppState()
  const [question, setQuestion] = useState('')

  if (!session) return null

  if (session.documents.length === 0) {
    return (
      <section className="empty-state paper-surface" aria-labelledby="understand-empty-title">
        <LockKeyhole aria-hidden="true" size={30} />
        <h1 id="understand-empty-title">Arithmetic is waiting for documents</h1>
        <p>Upload paperwork in Profile first. Nothing is calculated from an empty session.</p>
        <button type="button" className="button button--primary" onClick={() => navigate('profile')}>
          <ArrowRight aria-hidden="true" size={18} />
          Go to Profile
        </button>
      </section>
    )
  }

  if (!session.all_fields_confirmed) {
    return (
      <section className="blocking-state paper-surface" aria-labelledby="confirmation-title">
        <LockKeyhole aria-hidden="true" size={30} />
        <span className="eyebrow">Step 02 / understand</span>
        <h1 id="confirmation-title">Confirm the profile before arithmetic</h1>
        <p>RealDoor keeps the calculation surface blank while any extracted field still needs your review.</p>
        <button type="button" className="button button--primary" onClick={() => navigate('profile')}>
          <ArrowRight aria-hidden="true" size={18} />
          Review Profile
        </button>
      </section>
    )
  }

  const analysis = session.analysis
  if (!analysis) {
    return (
      <section className="loading-state paper-surface" aria-live="polite">
        <LoaderCircle className="spin" aria-hidden="true" size={26} />
        <h1>Refreshing the arithmetic ledger</h1>
        <p>The confirmed fields are saved. The current rule arithmetic is still loading.</p>
      </section>
    )
  }

  const threshold = analysis.threshold ?? config?.threshold ?? null
  const effectiveDate = analysis.effective_date ?? config?.effective_date ?? analysis.rule_citations[0]?.effective_date
  const difference = analysis.arithmetic_difference
  const formula = analysis.formula ?? 'frozen FY 2026 threshold − confirmed projected annual income'

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (question.trim().length === 0) return
    void askQuestion(question)
  }

  const askPrompt = (prompt: string) => {
    setQuestion(prompt)
    void askQuestion(prompt)
  }

  return (
    <div className="screen-stack">
      <header className="screen-heading">
        <div>
          <span className="eyebrow">Step 02 / neutral arithmetic</span>
          <h1>Understand</h1>
          <p>Read the confirmed numbers, the frozen reference, and the exact arithmetic behind the packet.</p>
        </div>
        <span className="quiet-mark">
          <Calculator aria-hidden="true" size={18} />
          No determination has been made
        </span>
      </header>

      <div className="understand-layout">
        <section className="arithmetic-column">
          <section className="arithmetic-ledger paper-surface" aria-labelledby="ledger-title">
            <div className="ledger-heading">
              <div>
                <span className="eyebrow">Current record</span>
                <h2 id="ledger-title">The arithmetic ledger</h2>
              </div>
              <span className="mono rule-tag">FY 2026 / frozen</span>
            </div>
            <div className="ledger-lines">
              <div className="ledger-line ledger-line--primary">
                <span>Confirmed projected annual income</span>
                <strong>{formatCurrency(analysis.annualized_income)}</strong>
              </div>
              <div className="ledger-line">
                <span>Frozen FY 2026 threshold</span>
                <strong>{formatCurrency(threshold)}</strong>
              </div>
              <div className="ledger-line ledger-line--difference">
                <span>Arithmetic difference</span>
                <strong>{formatCurrency(difference)}</strong>
              </div>
            </div>
            <div className="formula-block">
              <span className="meta-label">Formula</span>
              <code>{formula}</code>
              <p>Comparison recorded by the rule service: {analysis.comparison ?? 'not recorded'}.</p>
            </div>
          </section>

          <section className="rule-block" aria-labelledby="convention-title">
            <span className="eyebrow">Reading convention</span>
            <h2 id="convention-title">Challenge simulation uses a 60-day window</h2>
            <p>
              {config?.challenge_convention ??
                "Under the challenge's frozen simulation convention, evidence dated no more than 60 days before July 18, 2026 is treated as current. This is not a universal LIHTC rule."}
            </p>
            <dl className="rule-details">
              <div>
                <dt>Effective date</dt>
                <dd className="mono">{formatDate(effectiveDate)}</dd>
              </div>
              <div>
                <dt>Window</dt>
                <dd className="mono">{config?.challenge_window_days ?? 60} days</dd>
              </div>
              <div>
                <dt>Decision boundary</dt>
                <dd>{analysis.decision_boundary ?? 'The ledger reports arithmetic only. A human reviews the packet and context.'}</dd>
              </div>
            </dl>
          </section>

          <section className="source-breakdown" aria-labelledby="sources-title">
            <div className="section-heading-row">
              <div>
                <span className="eyebrow">Lineage</span>
                <h2 id="sources-title">Income source details</h2>
              </div>
              <span className="mono">{analysis.income_sources.length} sources</span>
            </div>
            {analysis.income_sources.length > 0 ? (
              <div className="source-table" role="table" aria-label="Income source details">
                <div className="source-table__head" role="row">
                  <span role="columnheader">Source</span>
                  <span role="columnheader">Annualized amount</span>
                  <span role="columnheader">Trace</span>
                </div>
                {analysis.income_sources.map((source, index) => {
                  const directField = source.field_id ? findField(session, source.field_id) : null
                  const citationFields = (source.citations ?? [])
                    .map((citation) => citation.field_id ? findField(session, citation.field_id) : null)
                    .filter((field): field is Field => field !== null)
                  const traceFields = Array.from(
                    (directField ? [directField] : citationFields).reduce((unique, field) => {
                      const key = `${field.document_id}:${field.page ?? 'page'}`
                      if (!unique.has(key)) unique.set(key, field)
                      return unique
                    }, new Map<string, Field>()).values(),
                  )
                  const sourceName = source.label ?? source.person ?? source.source_type ?? source.source_id ?? `Income source ${index + 1}`
                  return (
                    <div className="source-table__row" role="row" key={source.field_id ?? `${source.label}-${index}`}>
                      <span role="cell">
                        {sourceName}
                        {source.frequency ? <small className="source-subline">{source.frequency} · {source.basis ?? 'confirmed recurring source'}</small> : null}
                      </span>
                      <span role="cell" className="mono">{formatCurrency(sourceAmount(source))}</span>
                      <span role="cell">
                        {traceFields.length > 0 ? (
                          <span className="source-traces">
                            {traceFields.map((field, traceIndex) => (
                              <button
                                type="button"
                                className="source-link"
                                key={field.id}
                                onClick={(event) => onInspect(field, event.currentTarget)}
                                aria-label={`Inspect source ${traceIndex + 1} for ${sourceName}: ${field.label}`}
                              >
                                <FileSearch aria-hidden="true" size={15} />
                                Source {traceIndex + 1} · p{field.page ?? '?'}
                              </button>
                            ))}
                          </span>
                        ) : source.citations && source.citations.length > 0 ? (
                          <span className="source-traces">
                            {source.citations.map((citation, citationIndex) => (
                              <span className="source-reference mono" key={`${citation.document_id ?? 'document'}-${citation.page ?? 'page'}-${citationIndex}`}>
                                {citation.document_id ?? 'document'} · page {citation.page ?? 'not reported'}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="muted-copy">No field link</span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="empty-inline">No individual source details were returned for this record.</p>
            )}
          </section>
        </section>

        <aside className="understand-support" aria-label="Arithmetic support">
          <section className="qa-panel paper-surface" aria-labelledby="qa-title">
            <div className="section-kicker">
              <CircleHelp aria-hidden="true" size={17} />
              Rules Q&A
            </div>
            <h2 id="qa-title">Ask about the rule or arithmetic</h2>
            <div className="quick-prompts">
              {quickPrompts.map((prompt) => (
                <button type="button" className="prompt-button" key={prompt} onClick={() => askPrompt(prompt)} disabled={busy === 'question'}>
                  <span>{prompt}</span>
                  <ArrowRight aria-hidden="true" size={16} />
                </button>
              ))}
            </div>
            <form className="question-form" onSubmit={submitQuestion}>
              <label htmlFor="rule-question">Your question</label>
              <textarea
                id="rule-question"
                rows={4}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask about a source, formula, date, or rule."
              />
              <button type="submit" className="button button--primary" disabled={busy === 'question' || question.trim().length === 0}>
                {busy === 'question' ? <LoaderCircle className="spin" aria-hidden="true" size={17} /> : <MessageCircle aria-hidden="true" size={17} />}
                Ask question
              </button>
            </form>
            {lastQuestion ? (
              <div className="answer-block" aria-live="polite">
                <span className="meta-label">Answer</span>
                <p>{safeCitationText(lastQuestion.answer) ?? 'The source response was withheld because it included outcome wording.'}</p>
                {lastQuestion.refused || lastQuestion.refusal ? <p className="muted-copy">No unsupported answer was generated. Use the cited source or ask a human reviewer.</p> : null}
                {lastQuestion.citations && lastQuestion.citations.length > 0 ? (
                  <ul className="citation-list">
                    {lastQuestion.citations.map((citation, index) => (
                    <li key={citation.rule_id ?? citation.id ?? index}>
                        {citation.url ?? citation.source_url ? (
                          <a href={citation.url ?? citation.source_url} target="_blank" rel="noreferrer">
                            {citationName(citation, index)}
                            <ExternalLink aria-hidden="true" size={14} />
                          </a>
                        ) : (
                          citationName(citation, index)
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <div className="refusal-examples">
              <span className="meta-label">Refusal examples</span>
              <ul className="plain-list">
                <li>Requests to invent a missing document fact.</li>
                <li>Requests to make a final decision without source evidence.</li>
              </ul>
            </div>
          </section>

          <section className="citation-panel" aria-labelledby="citations-title">
            <div className="section-kicker">
              <BookOpen aria-hidden="true" size={17} />
              Authoritative citations
            </div>
            <h2 id="citations-title">The rule sources in this record</h2>
            {analysis.rule_citations.length > 0 ? (
              <ul className="citation-list citation-list--full">
                {analysis.rule_citations.map((citation, index) => (
                  <li key={citation.rule_id ?? citation.id ?? index}>
                    <span>{citationName(citation, index)}</span>
                    <span className="mono">{formatDate(citation.effective_date ?? effectiveDate)}</span>
                    {citation.url ?? citation.source_url ? (
                      <a href={citation.url ?? citation.source_url} target="_blank" rel="noreferrer" aria-label={`Open ${citationName(citation, index)}`}>
                        <ExternalLink aria-hidden="true" size={15} />
                      </a>
                    ) : null}
                    {safeCitationText(citation.excerpt ?? citation.text) ? <p>{safeCitationText(citation.excerpt ?? citation.text)}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">No citations were returned for this calculation.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
