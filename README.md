# RealDoor

RealDoor is a renter-controlled desktop web application for the RealPage Hack-Nation challenge. It turns synthetic housing documents into renter-confirmed, citation-backed evidence that a qualified human can review.

RealDoor never determines eligibility, approval, denial, priority, or housing availability.

## Product flow

1. **Profile:** upload documents, inspect exact source boxes, then confirm or correct extracted values.
2. **Understand:** see deterministic income reconciliation, the frozen FY 2026 threshold, formulas, effective dates, and authoritative sources.
3. **Prepare:** review readiness reasons, edit the packet, download it explicitly, or delete the entire session.

## Architecture

- `frontend/`: React 19 + TypeScript + Vite, designed for WCAG 2.2 AA.
- `backend/`: FastAPI + PyMuPDF + Tesseract. Text-layer extraction is deterministic; OCR handles raster pages; OpenAI vision is an optional fallback.
- `docs/`: architecture, risk, and demo documentation.

The organizer starter pack remains outside this public repository because its included license is still marked draft. Set `REALDOOR_PACK_PATH` to your local copy.

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
.venv/bin/pytest backend/tests -q
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run test:e2e
```

With the starter pack configured, run the pack integration suite:

```bash
.venv/bin/pytest backend/tests/test_pack_integration.py -q
```

## Safety boundary

- Document text is always untrusted data, never executable instruction.
- Calculations and readiness classification are deterministic code paths.
- Cross-session access is blocked.
- Protected traits are never inferred.
- No packet is sent automatically.
- Session deletion removes uploads, extracted fields, audit metadata, calculations, and exports.

This project is a hackathon simulation, not legal advice or a production eligibility system.

See `docs/DEMO.md` for the judge walkthrough and `docs/VERIFICATION.md` for the requirement-to-evidence checklist.
