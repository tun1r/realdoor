# Architecture and Risk Note

## Boundary

RealDoor classifies the readiness of an evidence packet. It does not classify people. `READY_TO_REVIEW` means the supplied packet can be handed to a qualified human reviewer. It never means the renter is eligible or likely to qualify.

## Data flow

```text
Session-scoped PDFs
  → deterministic document classification
  → PyMuPDF words and exact geometry
  → Tesseract OCR for raster pages
  → optional isolated OpenAI vision fallback
  → allowlisted candidate fields
  → renter confirmation or correction
  → deterministic source reconciliation and annualization
  → frozen FY 2026 threshold lookup
  → evidence-linked readiness classification
  → renter-previewed ZIP packet
  → explicit session deletion
```

Raw document text is untrusted. Models receive no tools, rule authority, cross-session access, or decision authority. Calculation, threshold lookup, citation validation, safety routing, and readiness classification are deterministic Python.

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
- Flags a supplied stale employment letter, matching HH-005.
- Includes gross gig receipts numerically while flagging missing corroboration, matching HH-004.
- Documents the zero-cent pay-reconciliation tolerance as a visible-fixture assumption because no organizer tolerance is provided.

## Privacy

Sessions use opaque IDs and isolated directories. Audit entries contain action names, timestamps, document IDs, and rule versions, never raw document text. Export is explicit. Deletion removes uploads, rendered pages, extracted fields, audit metadata, calculations, and packet artifacts.

## Deployment and provider risk

The app works entirely offline with PyMuPDF and Tesseract. OpenAI vision is opt-in and used only when deterministic extraction and OCR cannot resolve an allowlisted field. The provider/model and retention configuration must be disclosed before any real deployment.
