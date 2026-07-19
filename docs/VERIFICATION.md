# Verification evidence

| Requirement | Artifact and evidence |
| --- | --- |
| Git and GitHub repository | Git `main` with remote `https://github.com/tun1r/realdoor` and separate foundation, engine, frontend, and release commits. |
| Desktop frontend and design | `frontend/src/`, `DESIGN.md`; production build and desktop Playwright journey. |
| Accessibility | Skip link, semantic landmarks, focus traps/restoration, live regions, reduced motion, visible focus, and axe checks in `frontend/src/App.test.tsx`. |
| Deterministic extraction | PyMuPDF text geometry and fixed-DPI Tesseract in `backend/realdoor/extraction.py`; all 24 supplied PDFs tested. |
| Hybrid extraction | Explicitly enabled OpenAI vision fallback, schema-checked values, local-first disclosure, and provider-gating tests. |
| Provenance citations | Page, PDF-point bounding box, method, confidence, source preview, and rule lineage; coordinate regression tests. |
| Confirmation and correction | Typed correction API, correction history, confirmation gate, frontend correction and focus tests. |
| Income reconciliation | Frequency annualization, duplicate/corroborating source handling, benefit/gig sources, conflict and identity checks. |
| Readiness | Deterministic `READY_TO_REVIEW` / `NEEDS_REVIEW` reasons with plain-language, source-linked frontend explanations. |
| Safety and privacy | 24 adversarial cases, 36 gold Q&A records, untrusted-document isolation, explicit hosted-provider switch, bounded uploads, no automatic send, packet selection filtering, and complete deletion. |
| Packet export | Selected PDFs, printable HTML, structured `packet.json`, and schema-valid `submission.json`; excluded documents are reanalyzed out. |
| Supplied fixture outcomes | Six-household integration tests assert annual income, threshold comparison, readiness, and reasons. |

## Commands

```bash
env -u OPENAI_API_KEY .venv/bin/pytest backend/tests -q
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run test:e2e
git diff --check
```

Run the opt-in provider test only with a local, ignored `.env` containing the key and explicit hosted-vision switch:

```bash
set -a && source .env && set +a
REALDOOR_RUN_OPENAI_LIVE=true .venv/bin/pytest \
  backend/tests/test_coordinates_and_extraction.py::test_live_openai_fallback_extracts_schema_checked_fields -q
```

The live test uses a generated synthetic document, requires `OPENAI_API_KEY`, and verifies that hosted values remain uncited until local extraction supplies a source box. Never run it in public CI or commit `.env`.

The organizer starter pack is intentionally external because its included redistribution license is marked draft. Pack-backed tests run when `REALDOOR_PACK_PATH` points to the supplied local copy.
