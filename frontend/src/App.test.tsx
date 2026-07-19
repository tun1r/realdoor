import axe from 'axe-core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import type { DocumentRecord, Field, SessionState } from './types'

function makeField(overrides: Partial<Field> = {}): Field {
  return {
    id: 'field-income',
    name: 'monthly_wages',
    label: 'Monthly wages',
    value_type: 'currency',
    extracted_value: 3000,
    confirmed_value: null,
    confirmed: false,
    confidence: 0.96,
    method: 'paystub line item',
    document_id: 'document-paystub',
    page: 1,
    bbox: [0.12, 0.24, 0.45, 0.08],
    bbox_units: 'normalized',
    correction_history: [],
    ...overrides,
  }
}

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'document-paystub',
    file_name: 'paystub-june.pdf',
    document_type: 'Pay statement',
    page_count: 2,
    rasterized: true,
    contains_untrusted_instruction: true,
    status: 'active',
    replaces_document_id: null,
    superseded_by_document_id: null,
    superseded_at: null,
    fields: [makeField(), makeField({
      id: 'field-household-size',
      name: 'household_size',
      label: 'Household size',
      value_type: 'integer',
      extracted_value: 2,
      confidence: 0.91,
    })],
    ...overrides,
  }
}

function makeSession(confirmed = false, monthlyWages = 3000, status = 'NEEDS_REVIEW'): SessionState {
  const documents = [
    makeDocument({
      fields: [
        makeField({ extracted_value: monthlyWages, confirmed, confirmed_value: confirmed ? monthlyWages : null }),
        makeField({
          id: 'field-household-size',
          name: 'household_size',
          label: 'Household size',
          value_type: 'integer',
          extracted_value: 2,
          confirmed_value: confirmed ? 2 : null,
          confirmed,
          confidence: 0.91,
        }),
      ],
    }),
  ]

  return {
    schema_version: 2,
    id: 'session-001',
    created_at: '2026-07-18T12:00:00Z',
    updated_at: '2026-07-18T12:00:00Z',
    status: 'ready',
    documents,
    analysis: confirmed
      ? {
          household_size: 2,
          annualized_income: monthlyWages * 12,
          threshold: 50000,
          comparison: 'annualized income minus frozen threshold',
          arithmetic_difference: monthlyWages * 12 - 50000,
          readiness_status: status,
          review_issues: status === 'NEEDS_REVIEW' ? [{
            issue_id: 'issue-renter-note',
            code: 'RENTER_NOTE_REVIEW',
            message: 'Confirm the renter note before handoff.',
            affected_document_ids: [],
            affected_field_ids: [],
            rule_ids: [],
            action: { type: 'review_document', document_id: null, label: 'Review note' },
          }] : [],
          review_reasons: status === 'NEEDS_REVIEW' ? ['RENTER_NOTE_REVIEW'] : [],
          income_sources: [{
            source_id: 'wage-1',
            source_type: 'wage',
            document_ids: ['document-paystub'],
            amount: monthlyWages,
            frequency: 'monthly',
            annualized_amount: monthlyWages * 12,
            basis: 'confirmed monthly wages, annualized once',
            corroborated: true,
            citations: [{ field_id: 'field-income', document_id: 'document-paystub', page: 1 }],
          }],
          rule_citations: [{ rule_id: 'FY26-HOUSING-01', source_locator: 'FY 2026 household arithmetic', effective_date: '2026-01-01', source_url: 'https://example.com/rules/fy26' }],
          decision_boundary: 'A human reviewer considers the arithmetic alongside the complete packet.',
          effective_date: '2026-01-01',
          rule_version: 'FY26-HOUSING-01',
          formula: 'monthly wages × 12 − frozen FY 2026 threshold',
        }
      : null,
    packet: {
      included_document_ids: ['document-paystub'],
      renter_note: '',
      packet_complete: true,
      excluded_active_document_ids: [],
    },
    all_fields_confirmed: confirmed,
    replacement_events: [],
  }
}

const expiredEmploymentMessage = "Under the challenge\u2019s frozen 60-day document-freshness convention, this employment letter needs replacement."

function makeReplacementSession(phase: 'issue' | 'pending' | 'ready' = 'issue'): SessionState {
  const session = makeSession(true, 3830.6666667, 'READY_TO_REVIEW')
  const staleDocument = makeDocument({
    id: 'HH-005-D04',
    file_name: 'hh-005_d04_employment_letter.pdf',
    document_type: 'employment_letter',
    rasterized: true,
    contains_untrusted_instruction: false,
    fields: [makeField({
      id: 'HH-005-D04:document_date',
      name: 'document_date',
      label: 'Document date',
      value_type: 'date',
      extracted_value: '2026-04-14',
      confirmed_value: '2026-04-14',
      confirmed: true,
      document_id: 'HH-005-D04',
      method: 'ocr',
    })],
  })
  const issue = {
    issue_id: 'issue-expired-employment-letter',
    code: 'EMPLOYMENT_LETTER_EXPIRED',
    message: expiredEmploymentMessage,
    affected_document_ids: [staleDocument.id],
    affected_field_ids: ['HH-005-D04:document_date'],
    rule_ids: ['CH-READINESS-001'],
    action: { type: 'replace_document' as const, document_id: staleDocument.id, label: 'Replace document' },
  }
  session.documents = [session.documents[0], staleDocument]
  session.analysis = {
    ...session.analysis!,
    annualized_income: 45968,
    threshold: 111120,
    arithmetic_difference: 65152,
    readiness_status: 'NEEDS_REVIEW',
    review_issues: [issue],
    review_reasons: [issue.code],
    decision_boundary: 'Human review is required. No program determination was made.',
  }
  session.packet = {
    included_document_ids: ['document-paystub', staleDocument.id],
    renter_note: '',
    packet_complete: true,
    excluded_active_document_ids: [],
  }

  if (phase === 'issue') return session

  const pendingDocument = makeDocument({
    id: 'replacement-employment-letter',
    file_name: 'hh-005_fresh_employment_letter.pdf',
    document_type: 'employment_letter',
    rasterized: false,
    contains_untrusted_instruction: false,
    status: phase === 'pending' ? 'pending_replacement' : 'active',
    replaces_document_id: staleDocument.id,
    fields: [makeField({
      id: 'replacement-employment-letter:document_date',
      name: 'document_date',
      label: 'Document date',
      value_type: 'date',
      extracted_value: '2026-07-12',
      confirmed_value: phase === 'ready' ? '2026-07-12' : null,
      confirmed: phase === 'ready',
      document_id: 'replacement-employment-letter',
      method: 'text_layer',
    })],
  })
  session.documents.push(pendingDocument)

  if (phase === 'ready') {
    staleDocument.status = 'superseded'
    staleDocument.superseded_by_document_id = pendingDocument.id
    staleDocument.superseded_at = '2026-07-19T10:00:00Z'
    session.analysis = {
      ...session.analysis,
      readiness_status: 'READY_TO_REVIEW',
      review_issues: [],
      review_reasons: [],
      decision_boundary: 'Ready for human review. No program determination was made.',
    }
    session.packet.included_document_ids = ['document-paystub', pendingDocument.id]
    session.replacement_events = [{
      old_document_id: staleDocument.id,
      new_document_id: pendingDocument.id,
      timestamp: '2026-07-19T10:00:00Z',
      resolved_issue_ids: [issue.issue_id],
      resolved_issues: [issue],
    }]
    session.analysis.rule_citations.push({
      rule_id: 'CH-READINESS-001',
      source_locator: 'Frozen document-freshness convention',
      effective_date: '2026-01-01',
      source_url: 'https://example.com/rules/ch-readiness',
    })
  }

  return session
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installMockApi(
  initialSession = makeSession(false),
  options: {
    stageReplacement?: () => Promise<SessionState>
    replacementError?: string
  } = {},
) {
  let session = structuredClone(initialSession)
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url.endsWith('/api/config')) {
      return jsonResponse({
        pack_available: true,
        demo_households: ['HH-001', 'HH-002', 'HH-003', 'HH-004', 'HH-005', 'HH-006'],
        rule_version: 'FY26-HOUSING-01',
        threshold: 50000,
        effective_date: '2026-01-01',
        challenge_window_days: 60,
      })
    }
    if (url.includes('/api/sessions/demo/')) return jsonResponse(session)
    if (url.endsWith('/api/sessions') && method === 'POST') return jsonResponse(session)
    if (url.includes('/packet.zip')) return new Response(new Blob(['packet']), { status: 200, headers: { 'Content-Type': 'application/zip' } })
    if (url.includes('/documents/') && url.includes('/page/')) return new Response(new Blob(['page']), { status: 200, headers: { 'Content-Type': 'image/png' } })
    if (url.endsWith('/confirm-replacement') && method === 'POST') {
      session = makeReplacementSession('ready')
      return jsonResponse(session)
    }
    if (url.endsWith('/replacement') && method === 'POST') {
      if (options.replacementError) return jsonResponse({ detail: options.replacementError }, 422)
      session = options.stageReplacement
        ? await options.stageReplacement()
        : makeReplacementSession('pending')
      return jsonResponse(session)
    }
    if (url.endsWith('/confirm') && method === 'POST') {
      const currentMonthly = Number(session.documents[0].fields[0].confirmed_value ?? session.documents[0].fields[0].extracted_value)
      session = makeSession(true, currentMonthly)
      return jsonResponse(session)
    }
    if (url.includes('/fields/') && method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as { value: number }
      session = makeSession(false, body.value)
      return jsonResponse(session)
    }
    if (url.endsWith('/question') && method === 'POST') {
      return jsonResponse({ answer: 'The rule source explains the arithmetic and its effective date.', citations: [{ rule_id: 'FY26-HOUSING-01', title: 'FY 2026 household arithmetic', url: 'https://example.com/rules/fy26' }] })
    }
    if (url.endsWith('/packet') && method === 'PATCH') return jsonResponse(session)
    if (url.endsWith('/documents') && method === 'POST') return jsonResponse(session)
    if (url.endsWith('/session-001') && method === 'DELETE') return new Response(null, { status: 204 })
    if (url.endsWith('/session-001')) return jsonResponse(session)
    return jsonResponse({ detail: 'Unhandled test request' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, getSession: () => session }
}

async function loadDemo(user: ReturnType<typeof userEvent.setup>, session = makeSession(false)) {
  const api = installMockApi(session)
  render(<App />)
  await user.click(await screen.findByRole('button', { name: /HH-001/ }))
  await screen.findByRole('heading', { name: 'Profile' })
  return api
}

describe('RealDoor Evidence Desk', () => {
  it('shows welcome actions and loads a demo household', async () => {
    const user = userEvent.setup()
    const api = installMockApi()
    render(<App />)

    expect(screen.getByRole('heading', { name: /Make a renter packet/i })).toBeInTheDocument()
    const demoButton = await screen.findByRole('button', { name: /HH-001/ })
    expect(demoButton).toBeInTheDocument()
    await user.click(demoButton)

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(api.fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/sessions/demo/HH-001',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(screen.getByText('paystub-june.pdf')).toBeInTheDocument()
  })

  it('requests a correction and shows the refreshed income arithmetic downstream', async () => {
    const user = userEvent.setup()
    const api = await loadDemo(user)

    await user.click(screen.getByRole('button', { name: 'Correct Monthly wages' }))
    const correctionInput = screen.getByLabelText('Correct Monthly wages')
    await user.clear(correctionInput)
    await user.type(correctionInput, '3500')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/sessions/session-001/fields/field-income',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ value: 3500, confirmed: true }),
      }),
    ))

    await user.click(screen.getByRole('button', { name: 'Confirm all' }))
    await user.click(screen.getByRole('button', { name: 'Understand' }))
    expect(await screen.findByRole('heading', { name: 'Understand' })).toBeInTheDocument()
    expect(screen.getByText('$42,000', { selector: 'strong' })).toBeInTheDocument()
  })

  it('does not render prohibited outcome language', async () => {
    const user = userEvent.setup()
    await loadDemo(user, makeSession(true))
    await user.click(screen.getByRole('button', { name: 'Understand' }))
    await screen.findByRole('heading', { name: 'Understand' })
    await user.click(screen.getByRole('button', { name: 'Prepare' }))
    await screen.findByRole('heading', { name: 'Prepare' })

    expect(document.body.textContent).not.toMatch(/\b(eligible|ineligible|approved|denied|qualifies)\b/i)
  })

  it('renders readiness as an explicit status with an icon and text', async () => {
    const user = userEvent.setup()
    await loadDemo(user, makeSession(true, 3000, 'NEEDS_REVIEW'))
    await user.click(screen.getByRole('button', { name: 'Prepare' }))

    const ledger = await screen.findByText('NEEDS_REVIEW')
    expect(ledger).toBeInTheDocument()
    expect(ledger.closest('.readiness-ledger')?.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('Confirm the renter note before handoff.')).toBeInTheDocument()
  })

  it('closes the provenance inspector with Escape and restores focus', async () => {
    const user = userEvent.setup()
    await loadDemo(user)
    const sourceButton = screen.getByRole('button', { name: /See source for Monthly wages/ })
    await user.click(sourceButton)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Monthly wages' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sourceButton).toHaveFocus()
  })

  it('supports Escape focus return and successful session deletion', async () => {
    const user = userEvent.setup()
    await loadDemo(user, makeSession(true))
    await user.click(screen.getByRole('button', { name: 'Prepare' }))
    const deleteTrigger = screen.getByRole('button', { name: 'Delete session' })
    await user.click(deleteTrigger)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Uploaded document files and page previews')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteTrigger).toHaveFocus()

    await user.click(deleteTrigger)
    const openDialog = await screen.findByRole('dialog')
    await user.click(within(openDialog).getByRole('button', { name: 'Delete session' }))
    expect(await screen.findByRole('heading', { name: /Make a renter packet/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Session deleted')
  })

  it('restores the active evidence desk after a tab refresh', async () => {
    const api = installMockApi(makeSession(true))
    window.sessionStorage.setItem('realdoor.activeSessionId', 'session-001')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(api.fetchMock).toHaveBeenCalledWith('http://localhost:8000/api/sessions/session-001', expect.any(Object))
    expect(screen.getByRole('status')).toHaveTextContent('restored')
  })

  it('saves visible packet choices before downloading', async () => {
    const user = userEvent.setup()
    const api = await loadDemo(user, makeSession(true))
    await user.click(screen.getByRole('button', { name: 'Prepare' }))
    await user.type(screen.getByLabelText('Renter note'), 'Use this note.')

    await user.click(screen.getByRole('button', { name: 'Download packet (.zip)' }))

    await waitFor(() => expect(api.fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/sessions/session-001/packet',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ included_document_ids: ['document-paystub'], renter_note: 'Use this note.' }),
      }),
    ))
  })

  it('renders the backend issue message and links only its affected field to source', async () => {
    const user = userEvent.setup()
    await loadDemo(user, makeReplacementSession('issue'))
    await user.click(screen.getByRole('button', { name: 'Prepare' }))

    expect(await screen.findByText(expiredEmploymentMessage)).toBeInTheDocument()
    expect(screen.getByText('2026-04-14')).toBeInTheDocument()
    const sourceButton = screen.getByRole('button', {
      name: 'View source for Document date in hh-005_d04_employment_letter.pdf, issue EMPLOYMENT_LETTER_EXPIRED',
    })
    await user.click(sourceButton)
    expect(await screen.findByRole('dialog', { name: 'Document date' })).toBeInTheDocument()
  })

  it('does not infer issue fields from issue codes or frontend field names', async () => {
    const user = userEvent.setup()
    const session = makeReplacementSession('issue')
    session.analysis!.review_issues[0].affected_field_ids = []
    await loadDemo(user, session)
    await user.click(screen.getByRole('button', { name: 'Prepare' }))

    await screen.findByText(expiredEmploymentMessage)
    expect(screen.queryByRole('button', { name: /View source/ })).not.toBeInTheDocument()
    expect(screen.queryByText('2026-04-14')).not.toBeInTheDocument()
  })

  it('restores replacement picker focus when the native picker is cancelled', async () => {
    const user = userEvent.setup()
    await loadDemo(user, makeReplacementSession('issue'))
    await user.click(screen.getByRole('button', { name: 'Prepare' }))
    const trigger = await screen.findByRole('button', { name: 'Replace document' })
    const input = screen.getByLabelText('Choose a replacement PDF for hh-005_d04_employment_letter.pdf')

    await user.click(trigger)
    input.focus()
    fireEvent(input, new Event('cancel', { bubbles: true }))

    expect(trigger).toHaveFocus()
    expect(input).not.toHaveAttribute('multiple')
    expect(input).toHaveAttribute('accept', 'application/pdf,.pdf')
  })

  it('announces replacement phases, focuses the staged document, and does not confirm it', async () => {
    const user = userEvent.setup()
    let releaseStage!: (session: SessionState) => void
    const stageResult = new Promise<SessionState>((resolve) => {
      releaseStage = resolve
    })
    const api = installMockApi(makeReplacementSession('issue'), {
      stageReplacement: () => stageResult,
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /HH-001/ }))
    await user.click(screen.getByRole('button', { name: 'Prepare' }))
    const input = screen.getByLabelText('Choose a replacement PDF for hh-005_d04_employment_letter.pdf')
    const file = new File(['%PDF replacement'], 'hh-005_fresh_employment_letter.pdf', { type: 'application/pdf' })

    fireEvent.change(input, { target: { files: [file] } })
    expect(screen.getAllByText('Uploading replacement').length).toBeGreaterThan(0)
    expect(document.querySelector('.busy-marker')).toBeVisible()
    expect(document.querySelector('.busy-marker')).not.toHaveAttribute('aria-live')
    expect(document.querySelector('.sr-only[role="status"]')).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(screen.getAllByText('Extracting and validating replacement evidence').length).toBeGreaterThan(0))
    const stageCall = api.fetchMock.mock.calls.find(([url]) => String(url).endsWith('/documents/HH-005-D04/replacement'))
    expect(stageCall).toBeDefined()
    const stageBody = stageCall?.[1]?.body
    expect(stageBody).toBeInstanceOf(FormData)
    expect((stageBody as FormData).get('file')).toBe(file)
    releaseStage(makeReplacementSession('pending'))

    const pendingHeading = await screen.findByRole('heading', { name: 'hh-005_fresh_employment_letter.pdf' })
    await waitFor(() => expect(pendingHeading).toHaveFocus())
    expect(screen.getByText('Replacement awaiting renter confirmation.')).toBeInTheDocument()
    const pendingSection = pendingHeading.closest('section')!
    const pendingSource = within(pendingSection).getByRole('button', { name: /See source for Document date/ })
    await user.click(pendingSource)
    expect(await screen.findByRole('dialog', { name: 'Document date' })).toHaveTextContent(
      'Retained only in session provenance and excluded from the current packet.',
    )
    await user.keyboard('{Escape}')
    expect(pendingSource).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Confirm replacement evidence' })).toBeInTheDocument()
    expect(api.fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm-replacement'))).toBe(false)
  })

  it('keeps a staging error visible and restores focus to Replace document', async () => {
    const user = userEvent.setup()
    await loadDemo(user, makeReplacementSession('issue'))
    installMockApi(makeReplacementSession('issue'), { replacementError: 'Replacement document has the wrong document type' })
    await user.click(screen.getByRole('button', { name: 'Prepare' }))
    const trigger = screen.getByRole('button', { name: 'Replace document' })
    const input = screen.getByLabelText('Choose a replacement PDF for hh-005_d04_employment_letter.pdf')

    fireEvent.change(input, {
      target: { files: [new File(['%PDF wrong'], 'wrong.pdf', { type: 'application/pdf' })] },
    })
    input.focus()

    expect(await screen.findByText('Replacement document has the wrong document type')).toBeVisible()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('announces incomplete and complete packet transitions before choices are saved', async () => {
    const user = userEvent.setup()
    const session = makeReplacementSession('issue')
    await loadDemo(user, session)
    await user.click(screen.getByRole('button', { name: 'Prepare' }))

    const packetStatus = screen.getByRole('status', { name: 'Packet completeness' })
    expect(packetStatus).toHaveTextContent('Complete packet. All active documents are selected. submission.json will be included.')

    await user.click(screen.getByRole('checkbox', { name: /hh-005_d04_employment_letter\.pdf/ }))
    const warning = screen.getByRole('status', { name: 'Packet completeness' })
    expect(warning).toBeVisible()
    expect(warning).toHaveTextContent('Incomplete packet')
    expect(warning).toHaveTextContent('hh-005_d04_employment_letter.pdf')
    expect(warning).toHaveTextContent('No submission.json will be included. Canonical readiness remains unchanged.')
    expect(screen.getByText('NEEDS_REVIEW')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /hh-005_d04_employment_letter\.pdf/ }))
    expect(screen.getByRole('status', { name: 'Packet completeness' })).toHaveTextContent(
      'Complete packet. All active documents are selected. submission.json will be included.',
    )
  })

  it('keeps lifecycle provenance truthful and resolved rule metadata linked to the stale field', async () => {
    const user = userEvent.setup()
    await loadDemo(user, makeReplacementSession('ready'))

    const activeSource = screen.getByRole('button', { name: /See source for Monthly wages/ })
    await user.click(activeSource)
    expect(await screen.findByRole('dialog', { name: 'Monthly wages' })).toHaveTextContent(
      'Can be available as a source reference in packet review when the document is included.',
    )
    await user.keyboard('{Escape}')

    const staleSection = screen.getByRole('heading', { name: 'hh-005_d04_employment_letter.pdf' }).closest('section')!
    await user.click(within(staleSection).getByRole('button', { name: /See source for Document date/ }))
    const staleDrawer = await screen.findByRole('dialog', { name: 'Document date' })
    expect(staleDrawer).toHaveTextContent('Retained only in session provenance and excluded from the current packet.')
    expect(within(staleDrawer).getByText('Rule version').nextElementSibling).toHaveTextContent('CH-READINESS-001')

    await user.keyboard('{Escape}')
  })

  it('confirms pending evidence explicitly, focuses readiness, and preserves lifecycle provenance', async () => {
    const user = userEvent.setup()
    const api = await loadDemo(user, makeReplacementSession('pending'))
    const pendingLabel = screen.getByText('Pending replacement')
    expect(pendingLabel.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('Replacement awaiting renter confirmation.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirm replacement evidence' }))

    const readiness = await screen.findByLabelText('Readiness result: READY_TO_REVIEW')
    await waitFor(() => expect(readiness).toHaveFocus())
    expect(screen.getByText('$45,968')).toBeInTheDocument()
    expect(screen.getByText('$111,120')).toBeInTheDocument()
    expect(screen.getByText('No active review issues.')).toBeInTheDocument()
    expect(screen.getByText('Ready for human review. No program determination was made.')).toBeInTheDocument()
    expect(api.fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/confirm-replacement') && init?.method === 'POST')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Profile' }))
    const oldHeading = await screen.findByRole('heading', { name: 'hh-005_d04_employment_letter.pdf' })
    const oldSection = oldHeading.closest('section')!
    const newHeading = screen.getByRole('heading', { name: 'hh-005_fresh_employment_letter.pdf' })
    const newSection = newHeading.closest('section')!
    const supersededLabel = within(oldSection).getByText('Superseded')
    const activeLabel = within(newSection).getByText('Active')
    expect(supersededLabel.querySelector('svg')).toBeInTheDocument()
    expect(activeLabel.querySelector('svg')).toBeInTheDocument()
    expect(within(oldSection).getByRole('button', { name: /See source for Document date/ })).toBeInTheDocument()
    expect(within(oldSection).queryByRole('button', { name: /Correct Document date/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm replacement evidence' })).not.toBeInTheDocument()
  })

  it('passes axe checks with a replacement issue and a pending replacement', async () => {
    const user = userEvent.setup()
    installMockApi(makeReplacementSession('issue'))
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /HH-001/ }))
    await user.click(screen.getByRole('button', { name: 'Prepare' }))
    await screen.findByText(expiredEmploymentMessage)
    expect((await axe.run(document.body)).violations).toEqual([])

    const input = screen.getByLabelText('Choose a replacement PDF for hh-005_d04_employment_letter.pdf')
    await user.upload(input, new File(['%PDF replacement'], 'hh-005_fresh_employment_letter.pdf', { type: 'application/pdf' }))
    await screen.findByText('Replacement awaiting renter confirmation.')
    expect((await axe.run(document.body)).violations).toEqual([])
  })

  it('passes an axe check on welcome, profile, understand, and prepare', async () => {
    const user = userEvent.setup()
    installMockApi(makeSession(true))
    render(<App />)
    const welcomeResults = await axe.run(document.body)
    expect(welcomeResults.violations).toEqual([])

    await user.click(await screen.findByRole('button', { name: /HH-001/ }))
    await screen.findByRole('heading', { name: 'Profile' })
    const profileResults = await axe.run(document.body)
    expect(profileResults.violations).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Understand' }))
    await screen.findByRole('heading', { name: 'Understand' })
    const understandResults = await axe.run(document.body)
    expect(understandResults.violations).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Prepare' }))
    await screen.findByRole('heading', { name: 'Prepare' })
    const prepareResults = await axe.run(document.body)
    expect(prepareResults.violations).toEqual([])
  })
})
