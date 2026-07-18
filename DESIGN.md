# RealDoor Design System

## Visual Thesis

**The Evidence Desk:** a quiet, well-lit reading surface where renters turn scattered paperwork into a clear, inspectable packet. RealDoor should feel humane and precise, not like fintech, a government portal, or an opaque AI dashboard.

The interface is a workbench, not a scorecard. Every important value is visibly connected to a source. The renter remains in control.

## Typography

- **Newsreader:** page titles and major explanatory headings.
- **Instrument Sans:** navigation, body copy, labels, controls, and buttons.
- **IBM Plex Mono:** calculations, page references, dates, rule IDs, and provenance metadata.

Use sentence case. Never use viewport-scaled text. Data uses tabular numerals.

## Color

```css
--rd-canvas: #f1f4f1;
--rd-paper: #fffdf7;
--rd-surface-blue: #e7eff1;
--rd-surface-green: #e5efeb;
--rd-ink: #1d2a2c;
--rd-ink-muted: #4f6062;
--rd-rule: #c7d2cf;
--rd-door-green: #1a6658;
--rd-door-green-dark: #124b41;
--rd-audit-blue: #24596a;
--rd-attention: #825a14;
--rd-attention-wash: #f6e7c5;
--rd-danger: #963e3a;
--rd-danger-wash: #f4e2df;
--rd-focus: #0b6870;
```

Green means confirmed or actionable. Blue means source or explanation. Ochre means human review. Coral is reserved for destructive actions. Status is never communicated through color alone.

## Layout

- Desktop process rail: `240px`.
- Top bar: `64px`.
- Main reading width: `760px` to `880px`.
- Supporting column: `320px` to `360px`.
- Provenance Inspector: `440px` right-side drawer.
- Mobile breakpoint: `760px`; replace the rail with a compact top bar and stack support content.

Use left alignment, visible rules, and generous whitespace. Avoid nested cards. Paper-colored areas indicate reading or packet surfaces, not generic containers.

## Shape and Spacing

- Base unit: `4px`; preferred scale: `4, 8, 12, 16, 24, 32, 48, 64`.
- Tool radius: `4px`; compact labels: `2px`.
- Use one-pixel rules rather than heavy borders.
- Shadows are limited to temporary overlays:

```css
box-shadow: 0 16px 40px rgb(29 42 44 / 14%);
```

## Brand Motif

Vertical source lines and active-step rules behave like a doorway jamb. The motif comes from traceability, not decoration. The wordmark is text-led: `Real` in Instrument Sans, `Door` in Newsreader.

## Core Components

### Evidence row

Shows label, renter-confirmed value, state, source reference, and edit action. Supported states: `Confirmed`, `Needs review`, `Missing`, `Conflicting sources`, and `Entered by you`.

### Provenance Inspector

Clicking a value opens a drawer containing:

1. Highlighted PDF source.
2. Document, page, and bounding box.
3. Extracted and renter-confirmed values.
4. Confidence and extraction method.
5. Downstream calculations using the value.
6. Rule version, source URL, and effective date.
7. Correction history.

Lineage is presented as `Source → Read → Confirmed or changed → Used`.

### Rule block

A reading section with a blue left rule, plain-language rule, formula, effective date, and authoritative citation. It must never imply an eligibility outcome.

### Readiness ledger

Lists facts and explicit reason codes. It never shows a numeric score, rank, probability, green threshold check, or approval-like label.

## Motion

- Route/content transition: `160ms`, opacity plus `8px` movement.
- Drawer: `220ms` slide.
- Dialog: `160ms` opacity plus `4px` movement.
- Corrections animate only the values and calculations that changed.
- Respect `prefers-reduced-motion`; remove transforms and reduce transitions to near-zero.

## Accessibility Target

WCAG 2.2 AA:

- Complete keyboard operation and visible `:focus-visible` treatment.
- Programmatic error summary linked to invalid controls.
- `aria-live` announcements for extraction, confirmation, recalculation, export, and deletion.
- No color-only status.
- Focus trap in dialogs/drawers and focus restoration on close.
- Accessible names for source-highlight controls.
- Minimum 24px target size, with 44px preferred for primary and mobile controls.
- Reflow at 320px and 200% text zoom without horizontal page scrolling.

## Copy Guardrails

Prefer: “We found,” “Read from,” “Confirmed by you,” “Needs your review,” “See the source,” and “No eligibility determination has been made.”

Avoid: “AI-powered,” “qualifies,” “eligible,” “approved,” “instant decision,” “confidence score,” and “below threshold ✓.”

## Creative Risks

1. **Editorial serif headings:** makes rules feel readable and human rather than institutional.
2. **Evidence marks as identity:** source boxes, rules, and threshold lines form the brand language.
3. **Provenance visible by default:** more information than typical consumer apps, but justified by the renter's need to inspect and correct sensitive evidence.
