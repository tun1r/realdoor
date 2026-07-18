import axe from 'axe-core'
import { render, screen, waitFor, within } from '@testing-library/react'
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
          review_reasons: status === 'NEEDS_REVIEW' ? ['Confirm the renter note before handoff.'] : [],
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
    },
    all_fields_confirmed: confirmed,
  }
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installMockApi(initialSession = makeSession(false)) {
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
