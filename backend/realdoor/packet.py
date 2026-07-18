"""Explicit renter-controlled printable packet export."""

from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import datetime, timezone
from html import escape
from typing import Any

from .models import SessionState
from .storage import SessionRepository


def _safe_name(value: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", value)
    return name or "document.pdf"


def _field_citation(field: Any) -> str:
    if field.page is None or field.bbox is None:
        return "citation unavailable"
    return f"page {field.page}, PDF points bottom-left {field.bbox}"


def build_packet_zip(state: SessionState, repository: SessionRepository, household_id: str) -> bytes:
    selected_ids = set(state.packet.included_document_ids)
    selected_docs = [document for document in state.documents if document.id in selected_ids]
    generated_at = datetime.now(timezone.utc).isoformat()
    source_names: dict[str, str] = {}
    for document in selected_docs:
        name = _safe_name(document.file_name)
        if name in source_names.values():
            name = f"{document.id}-{name}"
        source_names[document.id] = name

    packet_json: dict[str, Any] = {
        "generated_at": generated_at,
        "renter_note": state.packet.renter_note,
        "included_document_ids": [document.id for document in selected_docs],
        "documents": [document.model_dump(mode="json") for document in selected_docs],
        "analysis": state.analysis.model_dump(mode="json") if state.analysis else None,
        "decision_boundary": "No eligibility determination is included.",
        "source_files": {document_id: f"documents/{name}" for document_id, name in source_names.items()},
    }
    submission_json = None
    if state.analysis is not None:
        citations = [
            citation
            for source in state.analysis.income_sources
            for citation in source.citations
        ]
        submission_json = {
            "household_id": household_id,
            "annualized_income": state.analysis.annualized_income,
            "comparison": state.analysis.comparison,
            "readiness_status": state.analysis.readiness_status,
            "citations": citations,
        }

    html_parts = [
        "<!doctype html>",
        '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>RealDoor evidence packet</title>",
        "<style>body{font:16px/1.5 system-ui,sans-serif;color:#17211b;max-width:900px;margin:2rem auto;padding:0 1rem}h1,h2{line-height:1.2}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #aeb9b0;padding:.5rem;text-align:left;vertical-align:top}th{background:#edf2ed}.note{white-space:pre-wrap;border-left:4px solid #437b57;padding:.5rem 1rem;background:#f4f7f4}.boundary{font-weight:600}@media print{body{margin:0;max-width:none}.no-print{display:none}}</style>",
        "</head><body>",
        "<header><h1>RealDoor evidence packet</h1>",
        f"<p>Generated {escape(generated_at)}. This packet is prepared for human review.</p></header>",
    ]
    if state.packet.renter_note:
        html_parts.append(f'<p class="note"><strong>Renter note</strong><br>{escape(state.packet.renter_note)}</p>')
    html_parts.append("<h2>Analysis</h2>")
    if state.analysis:
        analysis = state.analysis
        html_parts.append(
            "<table><tbody>"
            f"<tr><th scope=\"row\">Household size</th><td>{escape(str(analysis.household_size))}</td></tr>"
            f"<tr><th scope=\"row\">Annualized gross income</th><td>{escape(str(analysis.annualized_income))}</td></tr>"
            f"<tr><th scope=\"row\">Frozen threshold</th><td>{escape(str(analysis.threshold))}</td></tr>"
            f"<tr><th scope=\"row\">Comparison</th><td>{escape(analysis.comparison)}</td></tr>"
            f"<tr><th scope=\"row\">Readiness</th><td>{escape(analysis.readiness_status)}</td></tr>"
            f"<tr><th scope=\"row\">Review reasons</th><td>{escape(', '.join(analysis.review_reasons) or 'None')}</td></tr>"
            "</tbody></table>"
        )
    else:
        html_parts.append("<p>Analysis is not available until extracted fields are confirmed.</p>")
    html_parts.append('<p class="boundary">No eligibility determination is included.</p>')
    html_parts.append("<h2>Included source documents</h2>")
    for document in selected_docs:
        html_parts.append(f"<section><h3>{escape(document.file_name)}</h3><p>{escape(document.document_type)}</p>")
        html_parts.append("<table><thead><tr><th scope=\"col\">Field</th><th scope=\"col\">Confirmed value</th><th scope=\"col\">Source</th></tr></thead><tbody>")
        for field in document.fields:
            html_parts.append(
                f"<tr><th scope=\"row\">{escape(field.label)}</th><td>{escape(str(field.confirmed_value))}</td><td>{escape(_field_citation(field))}</td></tr>"
            )
        html_parts.append("</tbody></table></section>")
    if not selected_docs:
        html_parts.append("<p>No source documents were selected.</p>")
    html_parts.append("</body></html>")
    html_bytes = "".join(html_parts).encode("utf-8")

    output = io.BytesIO()
    with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("packet.json", json.dumps(packet_json, ensure_ascii=True, indent=2))
        archive.writestr("packet.html", html_bytes)
        if submission_json is not None:
            archive.writestr("submission.json", json.dumps(submission_json, ensure_ascii=True, indent=2))
        for document in selected_docs:
            archive.writestr(f"documents/{source_names[document.id]}", repository.source_path(state.id, document.id).read_bytes())
    return output.getvalue()
