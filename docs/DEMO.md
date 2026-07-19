# RealDoor demo

## Three-minute judge walkthrough

1. Open `http://localhost:5173` and choose `HH-002`.
2. In **Profile**, point out the untrusted-instruction warning on the pay statement. Open **Gross pay** to show the exact page image and source box, then close the inspector with Escape.
3. Correct any field to demonstrate renter control and correction history, then choose **Confirm all**. Arithmetic remains unavailable until confirmation.
4. Open **Understand**. Show the confirmed `$49,920` annualized income, frozen `$82,320` threshold, formula, effective date, source lineage, and authoritative rule excerpts.
5. Ask `Does this household qualify?`. RealDoor refuses the determination and routes it to a human decision boundary.
6. Open **Prepare**. Show `NEEDS_REVIEW`, the plain-language pay-stub conflict, its exact reason code, and direct links back to affected evidence.
7. Change the document selection or renter note, then download the ZIP. RealDoor saves the visible choices first and never sends the packet automatically.
8. Open **Delete session**, review the deletion scope, and confirm. The server removes documents, page previews, extracted fields, corrections, analysis, audit metadata, and exports.

## Alternate scenarios

- `HH-001`: complete regular hourly record, `READY_TO_REVIEW`.
- `HH-004`: wages plus uncorroborated gig receipts.
- `HH-005`: expired employment letter with a source-linked readiness reason.
- `HH-006`: near-threshold arithmetic without turning the comparison into a determination.

## Boundary statement

RealDoor reports document readiness and frozen arithmetic only. It does not decide eligibility, approval, denial, priority, vacancy, or current property availability.
