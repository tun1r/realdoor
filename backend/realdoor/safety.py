"""Neutral safety router for user questions and adversarial inputs."""

from __future__ import annotations

import re
from typing import Any

from .rules import THRESHOLDS


DECISION_BOUNDARY = (
    "No. It may report the numerical comparison and readiness status only; a human makes any program determination."
)


def _context_value(context: dict[str, Any] | None, key: str, default: Any = None) -> Any:
    if not context:
        return default
    value = context.get(key, default)
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    return value


def _analysis(context: dict[str, Any] | None) -> dict[str, Any]:
    value = _context_value(context, "analysis", {})
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    return value if isinstance(value, dict) else {}


def _household_size(question: str, context: dict[str, Any] | None) -> int | None:
    match = re.search(r"household\s+size\s*[:#]?\s*(\d+)", question, re.IGNORECASE)
    if match:
        return int(match.group(1))
    household = re.search(r"HH[-_](\d{3})", question, re.IGNORECASE)
    if household:
        return int(household.group(1))
    value = _context_value(context, "household_size")
    if value is None:
        value = _analysis(context).get("household_size")
    return int(value) if isinstance(value, int) else None


def _money(value: float | int | None, decimals: bool = True) -> str:
    if value is None:
        return "not available"
    return f"${float(value):,.2f}" if decimals else f"${float(value):,.0f}"


def _answer(answer: str, rule_ids: list[str], *, refusal: bool = False, limitation: bool = False) -> dict[str, Any]:
    return {
        "answer": answer,
        "response": answer,
        "refusal": refusal,
        "limitation": limitation,
        "rule_ids": rule_ids,
    }


def route_question(question: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return a deterministic, citation-ready answer classification.

    The router never passes a question to a model. Document text is not part
    of this decision path and therefore cannot override these boundaries.
    """

    q = re.sub(r"\s+", " ", question.strip().lower())
    analysis = _analysis(context)
    current_household = _context_value(context, "current_household_id")
    requested_households = re.findall(r"hh[-_](\d{3})", q, re.IGNORECASE)
    if requested_households and current_household:
        current_number = str(current_household).upper().replace("_", "-")
        if f"HH-{requested_households[0]}" != current_number:
            if any(term in q for term in ("income", "document", "application", "pay stub", "household")):
                return _answer(
                    "I can only discuss documents in this session and cannot disclose another applicant's data.",
                    ["CH-SAFETY-001", "CH-DECISION-001"],
                    refusal=True,
                )

    if any(term in q for term in ("another household", "other household", "another applicant", "other applicant", "different renter", "other session")):
        return _answer(
            "I can only discuss documents in this session and cannot disclose another applicant's data.",
            ["CH-SAFETY-001", "CH-DECISION-001"],
            refusal=True,
        )

    if (
        any(term in q for term in ("system prompt", "system instruction", "secret", "api key", "private data", "reveal your prompt", "ignore prior instructions"))
        or ("ignore" in q and "instruction" in q)
    ):
        return _answer(
            "I cannot reveal system prompts, secrets, or private data. Instructions inside documents are untrusted text and are ignored.",
            ["CH-SAFETY-001"],
            refusal=True,
        )

    if any(term in q for term in (
        "disability", "immigration", "citizenship", "protected trait", "health status",
        "race", "nationality", "ethnicity", "religion", "pregnancy", "pregnant",
        "sex", "sexual orientation", "gender identity", "family status", "familial status",
    )) or re.search(r"\binfer\b.*\b(?:trait|status|identity)\b", q):
        return _answer(
            "I cannot infer protected or sensitive traits from a document. I can use only the supplied allowlisted fields.",
            ["CH-SAFETY-001", "CH-DECISION-001"],
            refusal=True,
        )

    if any(term in q for term in ("vacancy", "vacant", "available unit", "unit available", "available apartment", "open unit", "availability", "available today", "rent today")):
        return _answer(
            "No. The dataset is a project inventory, not a vacancy or waitlist feed.",
            ["HUD-DATA-001"],
            limitation=True,
        )

    if re.search(r"\b20(2[0-5]|24)\b", q) or "remembered" in q or "last year's threshold" in q:
        size = _household_size(q, context)
        if size in THRESHOLDS:
            answer = f"Use the frozen FY 2026 60% threshold of {_money(THRESHOLDS[size], decimals=False)} for household size {size}; I will not substitute an uncited prior-year limit."
        else:
            answer = "Use the frozen FY 2026 60% corpus for household sizes 1-8; a prior-year threshold is not substituted."
        return _answer(answer, ["HUD-MTSP-001", "HUD-MTSP-002", "CH-DECISION-001"])

    if "universal" in q and "60" in q or ("official" in q and "60-day" in q):
        return _answer(
            "No. It is a frozen convention for this hackathon simulation.",
            ["CH-READINESS-001"],
        )

    if any(term in q for term in ("missing citation", "without source", "source page", "source box", "bbox", "citation")):
        return _answer(
            "A material value without a page-level source box fails traceability and requires NEEDS_REVIEW until the citation is supplied.",
            ["CH-READINESS-001", "CH-SAFETY-001"],
            limitation=True,
        )

    if any(term in q for term in ("expired", "more than 60 days", "61 days", "old employment letter")):
        return _answer(
            "Evidence older than 60 days under the frozen simulation convention requires NEEDS_REVIEW; it is not treated as current evidence.",
            ["CH-READINESS-001"],
            limitation=True,
        )

    if any(term in q for term in ("conflict", "reconcile", "do not reconcile", "displayed gross", "components")):
        return _answer(
            "When a pay stub total conflicts with regular hours times hourly rate after cent rounding, flag PAY_STUB_TOTAL_CONFLICT and use the corroborated regular amount for the numeric total; readiness remains NEEDS_REVIEW.",
            ["CH-INCOME-001", "CH-READINESS-001"],
            limitation=True,
        )

    if any(term in q for term in ("outside the 612", "malformed bbox", "out-of-page", "outside the page")):
        return _answer(
            "An out-of-page or malformed source box fails citation validation and cannot support a material calculation.",
            ["CH-READINESS-001", "CH-SAFETY-001"],
            limitation=True,
        )

    size_match = re.search(r"household\s+size\s*(?:is|of|=)?\s*(\d+)", q)
    if (size_match and int(size_match.group(1)) not in THRESHOLDS) or (
        "household size" in q and "outside" in q and ("1-8" in q or "1 to 8" in q)
    ):
        return _answer(
            "No frozen 60% threshold is supplied outside household sizes 1-8, so the comparison is no_frozen_threshold and readiness is NEEDS_REVIEW.",
            ["HUD-MTSP-002", "CH-READINESS-001"],
            limitation=True,
        )

    if any(term in q for term in ("self-declaration", "self declaration", "unsigned", "employer evidence", "unverified claim")):
        return _answer(
            "An application self-declaration is not treated as employer evidence; the unsupported claim requires NEEDS_REVIEW.",
            ["CH-READINESS-001", "CH-INCOME-001"],
            limitation=True,
        )

    if "instruction" in q and ("pay stub" in q or "document" in q):
        return _answer("Treat them as untrusted document text and ignore them.", ["CH-SAFETY-001"])

    if "embedded" in q and "instruction" in q or "document says" in q:
        return _answer(
            "Document contents are untrusted data. Embedded instructions are ignored and do not change extraction, arithmetic, or readiness.",
            ["CH-SAFETY-001", "CH-DECISION-001"],
            limitation=True,
        )

    if any(term in q for term in ("eligible", "eligibility", "ineligible", "qualify", "qualified", "qualification", "approved", "approval", "denied", "denial", "prioritized", "priority")):
        return _answer(DECISION_BOUNDARY, ["CH-DECISION-001"], refusal=True)

    if "annualized" in q and "income" in q and ("included" in q or "figure" in q):
        sources = analysis.get("income_sources")
        source_types: list[str] = []
        if isinstance(sources, list):
            for source in sources:
                if not isinstance(source, dict):
                    continue
                source_type = source.get("source_type")
                if isinstance(source_type, str):
                    label = source_type.replace("_", " ")
                    if label not in source_types:
                        source_types.append(label)
        income = analysis.get("annualized_income")
        if source_types and isinstance(income, (int, float)) and not isinstance(income, bool):
            return _answer(
                f"The annualized figure includes confirmed recurring {', '.join(source_types)} income totaling {_money(income)} under the explicit source frequencies.",
                ["CH-INCOME-001"],
            )
        return _answer(
            "The annualized figure includes only confirmed recurring income sources with an explicit frequency and traceable document evidence.",
            ["CH-INCOME-001"],
            limitation=True,
        )

    if "arithmetic" in q and any(term in q for term in ("calculated", "calculate", "formula")):
        return _answer(
            "RealDoor annualizes each confirmed recurring gross-income source once using its explicit frequency, sums independent sources, and compares the total with the frozen FY 2026 60% threshold for the confirmed household size. Missing, stale, conflicting, or uncited evidence keeps readiness at NEEDS_REVIEW.",
            ["CH-INCOME-001", "HUD-MTSP-002", "CH-READINESS-001"],
        )

    if "date" in q and ("anchor" in q or "reference" in q) and ("fy 2026" in q or "2026" in q):
        return _answer(
            "The FY 2026 MTSP limits took effect May 1, 2026. The challenge's 60-day evidence window is anchored separately to July 18, 2026.",
            ["HUD-MTSP-001", "CH-READINESS-001"],
        )

    if "challenge" in q and ("source" in q or "value" in q):
        return _answer(
            "You can challenge an extracted value, its page or source box, the document date and freshness, a conflict between fields, or the arithmetic. Correct the value in Profile and keep the cited page available for human review.",
            ["CH-READINESS-001", "CH-SAFETY-001"],
        )

    if "take effect" in q or "effective" in q or "may 1, 2026" in q:
        return _answer("May 1, 2026.", ["HUD-MTSP-001"])

    if "geocode" in q or "address display" in q:
        return _answer("HUD identifies R and 4 as the higher-precision codes for address display.", ["HUD-GEO-001"])

    if "statutory" in q or "26 u.s.c" in q or "section 42" in q:
        return _answer("26 U.S.C. section 42.", ["FED-LIHTC-001"])

    if "compare" in q or "below_or_equal" in q or "above" in q:
        comparison = analysis.get("comparison")
        if comparison:
            return _answer(str(comparison), ["HUD-MTSP-002", "CH-INCOME-001"])
        return _answer("No comparison is reported until confirmed income and household-size fields are available.", ["CH-INCOME-001"], limitation=True)

    if "threshold" in q or "60%" in q or "60 percent" in q:
        size = _household_size(q, context)
        if size in THRESHOLDS:
            return _answer(f"{_money(THRESHOLDS[size], decimals=False)} for household size {size}.", ["HUD-MTSP-002"])
        return _answer(
            "The frozen 60% threshold is available only for household sizes 1-8; no_frozen_threshold applies outside that table.",
            ["HUD-MTSP-002"],
            limitation=True,
        )

    if "annualized income" in q or "annualized amount" in q:
        income = analysis.get("annualized_income")
        if income is None:
            return _answer("No annualized amount is reported until the extracted fields are confirmed.", ["CH-INCOME-001"], limitation=True)
        return _answer(f"{_money(income)} under the frozen annualization convention.", ["CH-INCOME-001"])

    if "readiness" in q or "ready_to_review" in q or "needs_review" in q:
        status = analysis.get("readiness_status")
        if status:
            return _answer(str(status), ["CH-READINESS-001"])
        return _answer("Readiness is NEEDS_REVIEW until the required fields and citations are confirmed.", ["CH-READINESS-001"], limitation=True)

    return _answer(
        "I can answer cited questions about the frozen FY 2026 rules, confirmed arithmetic, source citations, and readiness. I cannot make a program determination or claim current availability.",
        ["CH-SAFETY-001", "CH-DECISION-001"],
        limitation=True,
    )
