export type View = 'welcome' | 'profile' | 'understand' | 'prepare'

export type JsonScalar = string | number | boolean | null

export type Bbox =
  | {
      x?: number
      y?: number
      width?: number
      height?: number
      x0?: number
      y0?: number
      x1?: number
      y1?: number
    }
  | [number, number, number, number]
  | number[]
  | null

export interface CorrectionHistoryEntry {
  at?: string
  timestamp?: string
  previous_value?: JsonScalar
  new_value?: JsonScalar
  value?: JsonScalar
  source?: string
  reason?: string
}

export interface Field {
  id: string
  name: string
  label: string
  value_type: string
  extracted_value: JsonScalar
  confirmed_value: JsonScalar
  confirmed: boolean
  confidence: number | null
  method: string
  document_id: string
  page: number | null
  bbox: Bbox
  bbox_units: string | null
  correction_history: CorrectionHistoryEntry[]
}

export interface DocumentRecord {
  id: string
  file_name: string
  document_type: string
  page_count: number
  rasterized: boolean
  contains_untrusted_instruction: boolean
  fields: Field[]
}

export interface IncomeSource {
  source_id?: string
  source_type?: string
  person?: string
  document_ids?: string[]
  corroborating_document_ids?: string[]
  field_id?: string
  label?: string
  amount?: number | null
  annualized_amount?: number | null
  frequency?: string
  basis?: string
  corroborated?: boolean
  citations?: SourceCitation[]
}

export interface SourceCitation {
  field_id?: string
  field?: string
  document_id?: string
  page?: number | null
  bbox?: Bbox
  bbox_units?: string | null
  value?: JsonScalar
}

export interface RuleCitation {
  rule_id?: string
  id?: string
  title?: string
  url?: string
  source_url?: string
  authority?: string
  source_locator?: string
  effective_date?: string
  excerpt?: string
  text?: string
}

export interface Analysis {
  household_size: number | null
  annualized_income: number | null
  threshold: number | null
  comparison: string | null
  arithmetic_difference: number | null
  readiness_status: 'READY_TO_REVIEW' | 'NEEDS_REVIEW' | string
  review_reasons: string[]
  income_sources: IncomeSource[]
  rule_citations: RuleCitation[]
  decision_boundary: string | null
  effective_date?: string | null
  rule_version?: string | null
  formula?: string | null
}

export interface PacketState {
  included_document_ids: string[]
  renter_note: string | null
}

export interface SessionState {
  id: string
  created_at: string
  updated_at: string
  status: string
  documents: DocumentRecord[]
  analysis: Analysis | null
  packet: PacketState
  all_fields_confirmed: boolean
}

export interface AppConfig {
  pack_available?: boolean
  demo_households?: string[]
  extraction_mode?: 'local_only' | 'local_plus_hosted_vision'
  hosted_vision_provider?: string | null
  rule_version?: string | null
  threshold?: number | null
  effective_date?: string | null
  fiscal_year?: string | number | null
  challenge_window_days?: number | null
  challenge_convention?: string | null
  rule_citations?: RuleCitation[]
}

export interface QuestionResponse {
  question?: string
  answer: string
  citations?: RuleCitation[]
  refused?: boolean
  refusal?: boolean
}

export interface ApiErrorState {
  message: string
  fieldId?: string
}

export type BusyKind =
  | 'config'
  | 'creating'
  | 'loading-demo'
  | 'uploading'
  | 'confirming'
  | 'correcting'
  | 'question'
  | 'packet'
  | 'exporting'
  | 'deleting'
  | null
