# Verification evidence

| Requirement | Artifact and evidence |
| --- | --- |
| Git and GitHub repository | Git `main` with remote `https://github.com/tun1r/realdoor` and separate foundation, engine, frontend, and release commits. |
| Desktop frontend and design | `frontend/src/`, `DESIGN.md`; production build and desktop Playwright journey. |
| Accessibility | Skip link, semantic landmarks, focus traps/restoration, single live-region operation updates, reduced motion, visible focus, lifecycle labels, and axe checks in `frontend/src/App.test.tsx`; desktop and 320px Playwright journeys cover the replacement drawer and packet status. |
| Deterministic extraction | PyMuPDF text geometry and fixed-DPI Tesseract in `backend/realdoor/extraction.py`; all 24 supplied PDFs tested. |
| Hybrid extraction | Explicitly enabled OpenAI vision fallback, schema-checked values, local-first disclosure, and provider-gating tests. |
| Provenance citations | Page, PDF-point bounding box, method, confidence, source preview, resolved-issue rule lineage, and rendered-page verification for local text-layer values; coordinate and adversarial-text regression tests. |
| Confirmation and correction | Typed correction API, correction history, confirmation gate, frontend correction and focus tests. |
| Income reconciliation | Frequency annualization, duplicate/corroborating source handling, benefit/gig sources, conflict and identity checks. |
| Schema migration | `migrate_session_data` treats a missing version as v1 and accepts explicit v1 before v2 validation. `backend/tests/test_replacement_lifecycle.py` proves explicit-v1 active defaults, source-name recovery, reanalysis, atomic persistence, and an unchanged second load. |
| Replacement lifecycle | The same suite covers local-only staging validation, pending isolation, explicit confirmation, atomic active/superseded promotion, provenance links/events, read-only history, and rejected-candidate rollback. |
| Readiness | `review_issues` is the structured source of truth; deterministic IDs link messages, documents, fields, rules, and actions. `review_reasons` is derived for legacy clients. |
| HH-005 clear fix | One stale-letter issue points to the `2026-04-14` source box. The project-owned `2026-07-12` replacement clears it while preserving `45968.0` annualized income and `111120.0` threshold, then returns the exact ready boundary. |
| Freshness | Unit tests prove ages 59 and 60 days are current, 61 is stale, and future dates are not current under the frozen July 18, 2026 simulation convention. This is not asserted as a universal LIHTC rule. |
| Safety and privacy | 24 adversarial cases, 36 gold Q&A records, untrusted-document isolation, explicit hosted-provider switch, bounded uploads, no automatic send, active-only packet selection, and complete server-side session deletion. |
| Packet export | ZIPs contain only selected active PDFs plus `packet.json` and printable HTML. Canonical analysis is unchanged by file omission; incomplete exports name `excluded_active_document_ids`, warn, and contain no `submission.json`. |
| Supplied fixture outcomes | Six-household integration tests assert annual income, threshold comparison, readiness, and reasons. |

## Local gates

Run from the repository root after the setup in `README.md`. Keep hosted vision disabled for deterministic gates.

```bash
env -u OPENAI_API_KEY .venv/bin/pytest backend/tests -q
.venv/bin/pytest backend/tests/test_replacement_lifecycle.py -q
.venv/bin/pytest backend/tests/test_freshness.py -q
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run test:e2e
git diff --check
```

`test:e2e` is the desktop Playwright gate. It covers the HH-005 one-blocker replacement journey, exact stale and fresh source values, explicit promotion, `READY_TO_REVIEW`, unchanged arithmetic, superseded provenance, and page-overflow regression.

## Packless CI simulation

The replacement fixture and lifecycle tests are owned by this repository and require no organizer pack. This is the focused packless gate used to prove the shipped flow still runs when `REALDOOR_PACK_PATH` is absent:

```bash
env -u OPENAI_API_KEY -u REALDOOR_PACK_PATH \
  .venv/bin/pytest backend/tests/test_replacement_lifecycle.py -q
```

In a checkout with no sibling starter-pack directory, the full backend CI command is:

```bash
env -u OPENAI_API_KEY .venv/bin/pytest backend/tests -q
```

Pack-backed tests skip in that environment; project-owned calculation, freshness, replacement, API-independent safety, and other local-fixture tests continue to run.

## Organizer-pack corpora

The test fixtures expect the organizer pack at `../RealDoor_Hackathon_Starter_Pack_v1/realdoor-hackathon-starter-pack`. Run each corpus explicitly so skips cannot be mistaken for coverage:

```bash
# Six households and their frozen arithmetic/readiness outcomes.
.venv/bin/pytest backend/tests/test_pack_integration.py -q

# All 36 gold questions, exact answers, rule IDs, and citation ordering.
.venv/bin/pytest backend/tests/test_qa_gold.py -q

# All 24 adversarial records and their expected routing behavior.
.venv/bin/pytest \
  backend/tests/test_safety_router.py::test_all_adversarial_categories_route_to_expected_behavior -q
```

The six-household expected outcomes are `HH-001` `56316.0/READY_TO_REVIEW`, `HH-002` `49920.0/NEEDS_REVIEW`, `HH-003` `40230.0/READY_TO_REVIEW`, `HH-004` `51008.0/NEEDS_REVIEW`, `HH-005` `45968.0/NEEDS_REVIEW` before replacement, and `HH-006` `105000.0/READY_TO_REVIEW`. Every fixture comparison is the literal `below_or_equal`; it remains arithmetic, not a program determination.

## GitHub Actions

`.github/workflows/ci.yml` runs on pushes and pull requests. Its Python 3.11 backend job installs `backend/requirements.txt` and runs `pytest backend/tests -q` without the external organizer pack, so pack-backed tests skip while the project-owned HH-005 replacement suite runs. Its Node 22 frontend job runs `npm ci`, unit tests, lint, and build. Playwright is intentionally a local gate and is not claimed as a GitHub Actions step.

Run the opt-in provider test only with a local, ignored `.env` containing the key and explicit hosted-vision switch:

```bash
set -a && source .env && set +a
REALDOOR_RUN_OPENAI_LIVE=true .venv/bin/pytest \
  backend/tests/test_coordinates_and_extraction.py::test_live_openai_fallback_extracts_schema_checked_fields -q
```

The live test uses a generated synthetic document, requires `OPENAI_API_KEY`, and verifies that hosted values remain uncited until local extraction supplies a source box. Never run it in public CI or commit `.env`.

The organizer starter pack is intentionally external because its included redistribution license is marked draft. Runtime configuration honors `REALDOOR_PACK_PATH`; the current pytest fixtures use the sibling path stated above.
