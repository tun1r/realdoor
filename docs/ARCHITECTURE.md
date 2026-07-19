# Architecture and Risk Note

## Boundary

RealDoor classifies the readiness of active evidence for human review. It does not classify people. `READY_TO_REVIEW` means deterministic analysis found no active `review_issues`. The exact ready boundary is `Ready for human review. No program determination was made.` It does not communicate eligibility, qualification, approval, denial, priority, or availability.

## Data flow

```text
Session-scoped PDFs
  → deterministic document classification
  → PyMuPDF words and exact geometry
  → Tesseract OCR for raster pages
  → optional isolated OpenAI vision fallback
  → allowlisted candidate fields
  → renter confirmation or correction
  → active-document reconciliation and annualization
  → frozen FY 2026 threshold lookup
  → structured, evidence-linked review issues
  → optional local-only replacement staging
  → explicit replacement confirmation and atomic promotion
  → renter-selected ZIP files plus canonical analysis
  → explicit session deletion
```

Raw document text is untrusted. Models receive no tools, rule authority, cross-session access, or decision authority. Calculation, threshold lookup, citation validation, safety routing, and readiness classification are deterministic Python. Locally extracted text-layer replacement values are checked against deterministic OCR of the rendered page before they can be staged; hosted vision is never used for replacement.

## Schema v2 load path

`SessionState` is persisted as schema v2. `SessionRepository.load_with_migration` treats a missing `schema_version` as v1 and also accepts explicit v1. It adds lifecycle defaults to every existing document (`status: active` and null replacement provenance), reconstructs packet completeness from active IDs, clears the old analysis, initializes `replacement_events`, and only then validates the v2 Pydantic model. Unsupported versions fail loading.

On a migrated load, `RealDoorService._load` reanalyzes active confirmed fields, recomputes packet state, updates the timestamp, and writes the complete v2 state through an atomic temporary-file replacement. A second load sees v2 and makes no migration write, so migration, reanalysis, and persistence are idempotent. The field-level contract is documented in `docs/SCHEMA.md`.

## Document lifecycle and provenance

- `active`: the only status used by confirmation-all, canonical analysis, readiness, packet completeness, and selectable/exported source PDFs.
- `pending_replacement`: locally extracted replacement evidence linked by `replaces_document_id`. It remains outside canonical analysis and packet selection while the renter inspects or corrects its fields. Bulk confirmation does not confirm it.
- `superseded`: retained, read-only historical evidence linked forward by `superseded_by_document_id` and `superseded_at`. It cannot be corrected, confirmed through the active-field endpoint, selected, or exported.

`replacement_events` records the old ID, new ID, promotion timestamp, and stable issue IDs resolved by reanalysis. Both source PDFs and their page previews remain session-scoped until deletion.

## Replacement API

`POST /api/sessions/{session_id}/documents/{document_id}/replacement` accepts one PDF for an active target. It enforces the upload limit, rejects a second pending candidate, disables hosted vision, requires all extracted fields to have local text/OCR values and exact source boxes, verifies text-layer values against rendered-page OCR, and validates document type, person or household identity, and employer/income-source continuity. A rejected candidate leaves persisted state and assets unchanged. A valid candidate is stored as `pending_replacement`; the active target and canonical analysis remain unchanged.

`POST /api/sessions/{session_id}/documents/{pending_document_id}/confirm-replacement` revalidates the pending evidence and target, rejects unresolved fields, confirms remaining extracted values, and promotes state under the repository transaction lock. In one atomic persisted state update it makes the pending document active, makes the old document superseded, swaps an included old ID for the new ID, reanalyzes, recomputes packet completeness, and appends provenance. The HH-005 promotion preserves annualized income `45968.0` and threshold `111120.0`, removes its only issue, and returns `READY_TO_REVIEW` with the exact ready boundary above.

## Readiness issues

`analysis.review_issues` is the source of truth. Each issue carries a stable `issue_id`, code, message, affected document and field IDs, rule IDs, and a typed next action. The `Analysis` model derives the legacy `review_reasons` list from unique issue codes on every validation; clients must not treat `review_reasons` as an independent input.

For HH-005 the exact issue message is:

> Under the challenge’s frozen 60-day document-freshness convention, this employment letter needs replacement.

The issue links `HH-005-D04`, its `document_date` field, rule `CH-READINESS-001`, and the `replace_document` action. Stable issue identity lets a replacement event record that this specific blocker was resolved.

## Frozen freshness convention

The event date is July 18, 2026. Under this simulation's frozen convention, a document date is current only when its age is from 0 through 60 days inclusive: May 19, 2026 is the oldest current date, May 18 is stale, and a future date is not current. This convention exists for the challenge and is not a universal LIHTC rule. HH-005's April 14, 2026 letter is stale; the project-owned July 12, 2026 replacement is current.

## Canonical analysis and packet selection

Canonical analysis and readiness always use all active documents, regardless of which files the renter selects for a ZIP. Packet selection accepts only IDs from the same session with `active` status. `packet_complete` is true exactly when every active document is included; `excluded_active_document_ids` lists every omitted active ID. Pending and superseded IDs are neither selectable nor counted toward completeness.

The ZIP always contains `packet.json` and `packet.html`, plus only the selected active PDFs. `packet.json.analysis` remains the canonical active-document analysis. When active files are omitted, `packet.json` and HTML carry an incomplete-packet warning naming the omitted IDs, and the ZIP does not contain `submission.json`. `submission.json` is emitted only when `packet_complete` is true and analysis exists; this file gate is separate from `READY_TO_REVIEW` versus `NEEDS_REVIEW`.

## Citation coordinates

The supplied gold annotations use PDF points with a bottom-left origin. PyMuPDF uses a top-left origin. For a page height `H`:

```text
PyMuPDF box = [x1, H - y2, x2, H - y1]
```

This mapping is verified against both the raster HH-001-D02 gross-pay box and its text-layer twin HH-001-D03. Regression tests pin the conversion.

## Organizer ambiguities

The draft pack contains contradictions between prose readiness rules and visible gold fixtures. RealDoor therefore:

- Implements generic evidence-quality rules.
- Treats employment letters as optional corroboration when absent, because HH-003 and HH-006 are visibly ready without one.
- Flags a supplied stale employment letter under the challenge's frozen convention, matching HH-005.
- Includes gross gig receipts numerically while flagging missing corroboration, matching HH-004.
- Documents the zero-cent pay-reconciliation tolerance as a visible-fixture assumption because no organizer tolerance is provided.

## Privacy

Sessions use opaque IDs and isolated directories. Audit entries contain action names, timestamps, document IDs, and rule versions, never raw document text. Export is explicit and generated in memory. Deletion removes the complete server-side session directory: active, pending, and superseded source PDFs; rendered pages; persisted fields, confirmations, corrections, lifecycle provenance, analysis, and packet settings; and audit records. It does not reach ZIP files already downloaded to another device.

## Deployment and provider risk

The app works entirely offline with PyMuPDF and Tesseract. OpenAI vision is opt-in and used only when deterministic extraction and OCR cannot resolve an allowlisted field. The provider/model and retention configuration must be disclosed before any real deployment.
