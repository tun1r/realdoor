import type { JsonScalar, SessionState } from './types'

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Not available'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatValue(value: JsonScalar, valueType?: string) {
  if (value === null || value === '') return 'Not found'
  if (valueType?.toLowerCase().includes('currency')) {
    const numericValue = typeof value === 'number' ? value : Number(value)
    if (!Number.isNaN(numericValue)) return formatCurrency(numericValue)
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

export function inputValue(value: JsonScalar) {
  if (value === null) return ''
  return String(value)
}

export function parseInputValue(value: string, valueType: string): JsonScalar {
  const type = valueType.toLowerCase()
  if (type.includes('number') || type.includes('integer') || type.includes('currency')) {
    const numericValue = Number(value.replace(/[$,]/g, ''))
    return Number.isNaN(numericValue) ? value : numericValue
  }
  if (type === 'boolean') return value === 'true'
  return value
}

export function allFields(session: SessionState) {
  return session.documents.flatMap((document) => document.fields)
}

export function findField(session: SessionState, fieldId: string) {
  return allFields(session).find((field) => field.id === fieldId) ?? null
}

export function formatDate(value: string | null | undefined) {
  if (!value) return 'Not provided'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function sourceLabel(documentName: string, page: number | null) {
  return `${documentName}, page ${page ?? 'not reported'}`
}

export function safeCitationText(value: string | null | undefined) {
  if (!value) return null
  if (/\b(eligible|ineligible|approved|denied|qualifies)\b/i.test(value)) return null
  return value
}
