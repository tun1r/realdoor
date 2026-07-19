# RealDoor

RealDoor is a renter-controlled desktop web application for the RealPage Hack-Nation challenge. It turns synthetic housing documents into renter-confirmed, citation-backed evidence that a qualified human can review.

RealDoor never determines eligibility, approval, denial, priority, or housing availability.

## Product flow

1. **Profile:** upload documents, inspect exact source boxes, then confirm or correct extracted values. Replacement evidence remains pending until it is explicitly confirmed.
2. **Understand:** see deterministic income reconciliation, the frozen FY 2026 threshold, formulas, effective dates, and authoritative sources.
3. **Prepare:** work from structured, source-linked review issues, replace a blocking document, edit the packet, download it explicitly, or delete the entire session.

The shipped HH-005 flow demonstrates one blocking document and one clear fix. Its expired employment letter produces exactly one `EMPLOYMENT_LETTER_EXPIRED` issue. A project-owned fresh synthetic letter can be staged, reviewed field by field, and explicitly confirmed. Promotion preserves the `$45,968` annualized amount and `$111,120` frozen threshold, changes readiness to `READY_TO_REVIEW`, and keeps the old evidence as read-only `Superseded` provenance.

## Architecture

- `frontend/`: React 19 + TypeScript + Vite, designed for WCAG 2.2 AA.
- `backend/`: FastAPI + PyMuPDF + Tesseract. Text-layer extraction is deterministic; OCR handles raster pages; OpenAI vision is an optional fallback.
- `docs/`: architecture, schema, demo, and verification documentation.

The organizer starter pack remains outside this public repository because its included license is still marked draft. Set `REALDOOR_PACK_PATH` to your local copy.

Persisted sessions use schema v2. Missing `schema_version` and explicit v1 records migrate to v2 before validation, then are deterministically reanalyzed and atomically persisted. Existing documents default to `active`; later loads are idempotent. See `docs/SCHEMA.md` for the complete contract.

## Local setup

```bash
cp .env.example .env
python -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
npm --prefix frontend install
```

Run the API:

```bash
.venv/bin/uvicorn realdoor.api:app --app-dir backend --reload --port 8000
```

Run the web app:

```bash
npm --prefix frontend run dev
```

Open `http://localhost:5173`.

Hosted vision is disabled by default, even when `OPENAI_API_KEY` is set. Enable `REALDOOR_ENABLE_HOSTED_VISION=true` only after confirming the provider's terms, retention controls, and event policy. The upload screen discloses the active extraction mode.

## Verification

```bash
env -u OPENAI_API_KEY .venv/bin/pytest backend/tests -q
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run test:e2e
git diff --check
```

The replacement lifecycle suite is project-owned and runs without the organizer pack:

```bash
env -u OPENAI_API_KEY -u REALDOOR_PACK_PATH \
  .venv/bin/pytest backend/tests/test_replacement_lifecycle.py -q
```

With the starter pack at the sibling path expected by the test fixtures, run the six-household, 36 gold Q&A, and 24-case adversarial gates:

```bash
.venv/bin/pytest backend/tests/test_pack_integration.py -q
.venv/bin/pytest backend/tests/test_qa_gold.py -q
.venv/bin/pytest \
  backend/tests/test_safety_router.py::test_all_adversarial_categories_route_to_expected_behavior -q
```

## Safety boundary

- Document text is always untrusted data, never executable instruction.
- Calculations and readiness classification are deterministic code paths.
- Canonical readiness uses all and only `active` documents; packet file selection does not rewrite that analysis.
- An incomplete export identifies omitted active document IDs, includes a warning, and does not contain `submission.json`.
- Cross-session access is blocked.
- Protected traits are never inferred.
- No packet is sent automatically.
- Session deletion removes the server-side session directory, including active, pending, and superseded source files, rendered pages, fields, corrections, lifecycle metadata, analysis, packet settings, and audit records. It cannot remove ZIP files already downloaded to the renter's device.

This project is a hackathon simulation, not legal advice or a production eligibility system.

See `docs/ARCHITECTURE.md` for system boundaries, `docs/SCHEMA.md` for the v2 persistence and API contract, `docs/DEMO.md` for the final 75-second walkthrough, and `docs/VERIFICATION.md` for local and CI evidence.
