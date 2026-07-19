# Session Schema v2

## Scope

The persisted `session.json` contract is `schema_version: 2`. API session responses use the same `SessionState` shape. Pydantic models reject unknown fields. This document describes persistence and lifecycle behavior; `docs/ARCHITECTURE.md` describes why those boundaries exist.

## Migration

`SessionRepository.load_with_migration` reads raw JSON and calls `migrate_session_data` before Pydantic validation.

- Missing `schema_version` is treated as v1; explicit `schema_version: 1` follows the same path.
- Every existing document defaults to `status: active`, `replaces_document_id: null`, `superseded_by_document_id: null`, and `superseded_at: null`.
- Existing packet IDs are deduplicated. `excluded_active_document_ids` is rebuilt from active IDs omitted from `included_document_ids`, and `packet_complete` is derived from whether that list is empty.
- Legacy analysis is cleared so it cannot bypass the v2 structured-issue contract. `replacement_events` starts empty.
- The migrated object is validated as v2. Unsupported schema versions fail loading.
- The service then reanalyzes active confirmed fields, recomputes packet state, updates `updated_at`, and atomically replaces `session.json`. A subsequent v2 load performs no migration or persistence write.

## SessionState

| Field | Type | Contract |
| --- | --- | --- |
| `schema_version` | literal `2` | Current persistence version. |
| `id` | string | Opaque canonical UUID used for session isolation. |
| `created_at`, `updated_at` | UTC timestamp strings | Session lifecycle timestamps. |
| `status` | string | Session status carried by the API. |
| `documents` | `DocumentRecord[]` | Active and historical evidence in one provenance graph. |
| `analysis` | `Analysis` or null | Available only when all active fields are confirmed and non-null. |
| `packet` | `PacketState` | Renter file selection, note, and completeness metadata. |
| `all_fields_confirmed` | boolean | Derived from all and only active document fields. |
| `replacement_events` | `ReplacementEvent[]` | Append-only promotion provenance within the session state. |

## DocumentRecord

All documents retain extraction metadata and `fields`. Lifecycle fields are:

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | `active`, `pending_replacement`, or `superseded` | Controls analysis, mutation, packet selection, and export. Defaults to `active`. |
| `replaces_document_id` | string or null | Back-link from pending or promoted replacement to the old document. |
| `superseded_by_document_id` | string or null | Forward-link from old evidence to its promoted replacement. |
| `superseded_at` | timestamp or null | Promotion timestamp on the old document. |

Only `active` documents feed canonical analysis and packet completeness. A `pending_replacement` can be inspected and corrected but is skipped by bulk confirmation and remains outside analysis and packet selection. A `superseded` document is read-only and cannot be confirmed, selected, or exported. Pending and superseded assets remain in the isolated session directory for provenance until deletion.

## Analysis and ReviewIssue

`Analysis.review_issues` is authoritative. Each `ReviewIssue` contains:

| Field | Meaning |
| --- | --- |
| `issue_id` | Stable `issue-` ID derived from code, linked document/field/rule IDs, and action type/target. The human message is intentionally not part of identity. |
| `code` | Machine-readable reason such as `EMPLOYMENT_LETTER_EXPIRED`. |
| `message` | Human-readable explanation shown in the review ledger. |
| `affected_document_ids` | Evidence records linked to the issue. |
| `affected_field_ids` | Exact extracted/confirmed fields linked to source inspection. |
| `rule_ids` | Frozen rules used by the issue. |
| `action` | Typed `add_document`, `correct_field`, `review_document`, or `replace_document` action with target ID and label. |

The `Analysis` model validator always derives `review_reasons` from unique `review_issues[].code` values in issue order. `review_reasons` exists for legacy consumers and is not an independent source of truth. `readiness_status` is exactly `READY_TO_REVIEW` when `review_issues` is empty; otherwise it is `NEEDS_REVIEW`.

For the shipped HH-005 blocker, the source-of-truth issue has code `EMPLOYMENT_LETTER_EXPIRED`, links `HH-005-D04` and its `document_date` field, cites `CH-READINESS-001`, and requests `replace_document`. Its exact message is:

> Under the challenge’s frozen 60-day document-freshness convention, this employment letter needs replacement.

## PacketState

| Field | Type | Contract |
| --- | --- | --- |
| `included_document_ids` | string array | Deduplicated, active, same-session documents selected for ZIP export. |
| `renter_note` | string or null | Optional note, limited to 4,000 characters by the API request model. |
| `packet_complete` | boolean | True exactly when no active document is omitted. |
| `excluded_active_document_ids` | string array | Active IDs absent from `included_document_ids`, in active document order. |

Packet selection does not change `analysis` or `readiness_status`. ZIP generation filters source files to selected active IDs but embeds canonical analysis in `packet.json`. If `packet_complete` is false, `packet.json.warnings` and `packet.html` name omitted active IDs and `submission.json` is absent. If `packet_complete` is true and `analysis` exists, `submission.json` is emitted even when readiness is `NEEDS_REVIEW`; completeness and readiness are separate gates.

## ReplacementEvent

Each confirmed promotion appends:

| Field | Meaning |
| --- | --- |
| `old_document_id` | Active evidence changed to superseded. |
| `new_document_id` | Pending evidence promoted to active. |
| `timestamp` | Same promotion timestamp stored as the old document's `superseded_at`. |
| `resolved_issue_ids` | Stable issue IDs present before promotion and absent after canonical reanalysis. |
| `resolved_issues` | Full structured issue snapshots, including message, affected fields, and rule IDs, retained for historical provenance. |

Promotion also replaces the old ID with the new ID in `included_document_ids` when the old document was selected. The old source and the new source remain addressable inside the session, but only the new active source can feed analysis or export.

## Replacement endpoints

### `POST /api/sessions/{session_id}/documents/{document_id}/replacement`

Multipart field: `file`.

Validation requires an existing active target with no other pending candidate, a PDF within the per-file upload limit, successful local text-layer/OCR extraction plus rendered-page verification for text-layer values, a value and exact PDF-point source box for every extracted replacement field, matching document type and person/household identity, and matching or corroborated employer/income-source continuity. Hosted vision is disabled for this path. A successful response adds a `pending_replacement`; a rejected request does not change state or retain candidate assets. Replacement errors use a `{ "detail": string }` body and are documented as 404, 409, 413, or 422 responses.

### `POST /api/sessions/{session_id}/documents/{pending_document_id}/confirm-replacement`

No request body. The endpoint requires a pending document with an active target, repeats identity and source validation, rejects unresolved fields, and confirms any remaining extracted values. Under the repository transaction lock it promotes the new document, supersedes the old one, transfers packet inclusion when applicable, reanalyzes, recomputes packet completeness, appends the replacement event, and atomically persists the resulting v2 state.

## Deletion

`DELETE /api/sessions/{session_id}` removes the complete server-side directory for that UUID. This includes all active, pending, and superseded source PDFs and rendered pages, `session.json` with fields/corrections/analysis/packet/lifecycle data, and `audit.jsonl`. Packet ZIPs are generated in memory; a ZIP already downloaded to a renter-controlled device is outside server deletion scope.
