# RealDoor demo

## Final 75-second demo sequence

1. **One blocker (0:00-0:10):** Open `http://localhost:5173`, choose `HH-005`, select **Confirm all**, and open **Prepare**. Show exactly one structured issue, `EMPLOYMENT_LETTER_EXPIRED`, with the message `Under the challenge’s frozen 60-day document-freshness convention, this employment letter needs replacement.`
2. **Exact stale-date source box (0:10-0:20):** In that issue, show **Document date: 2026-04-14**, select **View source**, and point to the exact highlighted PDF source box. Close the dialog with Escape to show focus returning to the source control.
3. **Fresh synthetic replacement (0:20-0:32):** Select **Replace document** and upload `backend/tests/fixtures/hh-005_fresh_employment_letter.pdf`. State that it is a project-owned synthetic text-layer PDF dated `2026-07-12`; replacement extraction is local-only and validates type, identity, source continuity, values, and source boxes before staging.
4. **Review/confirm only fields (0:32-0:44):** On **Profile**, show the pending replacement linked to the old letter. Inspect the extracted person, document date, weekly hours, hourly rate, and source name against their source boxes; correct a field only if needed, then select **Confirm replacement evidence**. The pending document stays outside canonical arithmetic until this explicit confirmation.
5. **READY_TO_REVIEW (0:44-0:54):** Back on **Prepare**, show focused `READY_TO_REVIEW`, `No active review issues.`, and the exact boundary `Ready for human review. No program determination was made.`
6. **Old evidence Superseded (0:54-1:04):** Return to **Profile**. Show the old `hh-005_d04_employment_letter.pdf` labeled `Superseded`, the fresh replacement labeled `Active`, and the links between them. The old fields are read-only and retained as provenance.
7. **Unchanged calculation and human-review boundary (1:04-1:15):** Return to the readiness summary and show that the replacement did not change the arithmetic: annualized income remains `$45,968` and the frozen five-person threshold remains `$111,120`. Close on the human-review boundary; the status describes evidence readiness only.

## Alternate scenarios

- `HH-001`: complete regular hourly record, `READY_TO_REVIEW`.
- `HH-004`: wages plus uncorroborated gig receipts.
- `HH-005`: one expired employment-letter blocker with the explicit replacement flow above.
- `HH-006`: near-threshold arithmetic without turning the comparison into a determination.

## Boundary statement

RealDoor reports active-evidence readiness and frozen arithmetic only. It does not communicate eligibility, qualification, approval, denial, priority, vacancy, or current property availability.
