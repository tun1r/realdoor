"""Application services: confirmation, reconciliation, readiness, and demos."""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import re
import uuid
from datetime import date
from pathlib import Path
from typing import Any, Iterable

from .calculations import annualize, compare_to_threshold
from .config import Settings
from .coordinates import BBOX_UNITS, validate_bbox
from .extraction import ExtractionError, ExtractionResult, extract_document, verify_rendered_text_layer
from .freshness import is_current
from .models import (
    Analysis,
    ConfirmRequest,
    CorrectionRecord,
    DocumentRecord,
    FieldRecord,
    IncomeSource,
    PacketState,
    ReplacementEvent,
    ReviewAction,
    ReviewIssue,
    SessionState,
    utc_now,
)
from .packet import build_packet_zip
from .rules import THRESHOLDS, RuleStore
from .safety import route_question
from .storage import InvalidIdentifier, SessionNotFound, SessionRepository, validate_document_id


logger = logging.getLogger(__name__)


class ServiceError(ValueError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _dedupe(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(values))


def _field(document: DocumentRecord, name: str) -> FieldRecord | None:
    return next((item for item in document.fields if item.name == name), None)


def _value(document: DocumentRecord, name: str) -> Any:
    item = _field(document, name)
    if item is None or not item.confirmed:
        return None
    return item.confirmed_value


def _effective_value(document: DocumentRecord, name: str) -> Any:
    item = _field(document, name)
    if item is None:
        return None
    return item.confirmed_value if item.confirmed else item.extracted_value


def _normalized_text(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return " ".join(value.casefold().split())


def _active_documents(state: SessionState) -> list[DocumentRecord]:
    return [document for document in state.documents if document.status == "active"]


def _citation(document: DocumentRecord, names: Iterable[str]) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    for name in names:
        item = _field(document, name)
        if item is None:
            continue
        citations.append(
            {
                "field_id": item.id,
                "field": item.name,
                "document_id": document.id,
                "page": item.page,
                "bbox": item.bbox,
                "bbox_units": item.bbox_units,
                "value": item.confirmed_value,
            }
        )
    return citations


def _as_date(value: Any, month: bool = False) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(f"{value}-01" if month and len(value) == 7 else value)
    except ValueError:
        return None


def _source_id(source_type: str, index: int) -> str:
    return f"{source_type}-{index}"


class RealDoorService:
    def __init__(self, settings: Settings | None = None, repository: SessionRepository | None = None) -> None:
        self.settings = settings or Settings.from_env()
        self.repository = repository or SessionRepository(self.settings.session_dir)
        self.rules = RuleStore(
            self.settings.rules_path if self.settings.pack_available else None,
            self.settings.qa_path if self.settings.pack_available else None,
        )

    def create_session(self) -> SessionState:
        now = utc_now()
        state = SessionState(
            id=str(uuid.uuid4()),
            created_at=now,
            updated_at=now,
            status="IN_PROGRESS",
        )
        return self.repository.create(state)

    def demo_households(self) -> list[str]:
        if not self.settings.pack_available:
            return []
        with self.settings.manifest_path.open(newline="", encoding="utf-8") as handle:
            rows = csv.DictReader(handle)
            households = {row["household_id"] for row in rows if row.get("household_id")}
        return sorted(households)

    def create_demo_session(self, household_id: str) -> SessionState:
        household_id = household_id.upper()
        if household_id not in self.demo_households():
            raise ServiceError("Demo household not found", 404)
        with self.settings.manifest_path.open(newline="", encoding="utf-8") as handle:
            rows = [row for row in csv.DictReader(handle) if row.get("household_id") == household_id]
        state = self.create_session()
        try:
            for row in rows:
                source_path = self.settings.documents_path / row["file_name"]
                if not source_path.is_file():
                    raise ServiceError(f"Fixture document is missing: {row['file_name']}", 503)
                self._add_document(
                    state.id,
                    row["file_name"],
                    source_path.read_bytes(),
                    expected_type=row["document_type"],
                    document_id=row["document_id"],
                )
            return self.repository.load(state.id)
        except Exception:
            try:
                self.repository.delete(state.id)
            except Exception:
                pass
            raise

    def add_documents(self, session_id: str, files: list[tuple[str, bytes]]) -> SessionState:
        state = self._load(session_id)
        if not files:
            raise ServiceError("At least one PDF is required", 422)
        if len(files) > self.settings.max_upload_files:
            raise ServiceError("Too many files in one upload", 413)
        if sum(len(data) for _, data in files) > self.settings.max_upload_total_bytes:
            raise ServiceError("Combined upload is too large", 413)
        for file_name, data in files:
            if len(data) > self.settings.max_upload_bytes:
                raise ServiceError("Uploaded file is too large", 413)
            safe_name = Path(file_name).name or "document.pdf"
            self._add_document(state.id, safe_name, data)
        return self.repository.load(state.id)

    def _add_document(
        self,
        session_id: str,
        file_name: str,
        data: bytes,
        *,
        expected_type: str | None = None,
        document_id: str | None = None,
    ) -> DocumentRecord:
        generated_id = document_id or str(uuid.uuid4())
        try:
            validate_document_id(generated_id)
            result: ExtractionResult = extract_document(
                data,
                file_name,
                self.settings,
                document_id=generated_id,
                expected_type=expected_type,
            )
            verify_rendered_text_layer(result.document, result.page_images)
            with self.repository.transaction():
                state = self._load(session_id)
                assets_staged = False
                try:
                    self.repository.append_document(
                        session_id,
                        result.document,
                        result.source_bytes,
                        result.page_images,
                        audit=False,
                    )
                    assets_staged = True
                    state.documents.append(result.document)
                    if result.document.id not in state.packet.included_document_ids:
                        state.packet.included_document_ids.append(result.document.id)
                    self._recompute_packet(state)
                    state.updated_at = utc_now()
                    self._reanalyze(state)
                    self.repository.save(state)
                except Exception:
                    if assets_staged:
                        self.repository.remove_document_assets(session_id, result.document.id)
                    raise
            self._audit_best_effort(session_id, "document_processed", [result.document.id])
            return result.document
        except (ExtractionError, InvalidIdentifier) as exc:
            raise ServiceError(str(exc), 422) from exc
        except SessionNotFound as exc:
            raise ServiceError("Session not found", 404) from exc

    def get_session(self, session_id: str) -> SessionState:
        return self._load(session_id)

    def confirm(self, session_id: str, request: ConfirmRequest) -> SessionState:
        with self.repository.transaction():
            state = self._load(session_id)
            if request.field_ids is None:
                targets = [
                    (document, field)
                    for document in _active_documents(state)
                    for field in document.fields
                    if not field.confirmed
                ]
            else:
                targets = [self._resolve_field(state, field_id) for field_id in request.field_ids]
                inactive = next((document for document, _ in targets if document.status != "active"), None)
                if inactive is not None:
                    raise ServiceError("Only active document fields can be confirmed through this endpoint", 409)
            for _, item in targets:
                if item.confirmed or item.extracted_value is None:
                    continue
                item.confirmed_value = item.extracted_value
                item.confirmed = True
            state.updated_at = utc_now()
            self._reanalyze(state)
            self.repository.save(state)
        self._audit_best_effort(session_id, "fields_confirmed")
        return state

    def correct_field(self, session_id: str, field_id: str, value: Any, confirmed: bool = True) -> SessionState:
        with self.repository.transaction():
            state = self._load(session_id)
            document, item = self._resolve_field(state, field_id)
            if document.status == "superseded":
                raise ServiceError("Superseded documents are read-only", 409)
            normalized = self._coerce_field_value(item, value)
            previous = item.confirmed_value if item.confirmed else item.extracted_value
            item.correction_history.append(
                CorrectionRecord(
                    timestamp=utc_now(),
                    previous_value=previous,
                    new_value=normalized,
                    confirmed=confirmed,
                )
            )
            item.confirmed = confirmed and normalized is not None
            item.confirmed_value = normalized if item.confirmed else None
            state.updated_at = utc_now()
            self._reanalyze(state)
            self.repository.save(state)
        self._audit_best_effort(session_id, "field_corrected")
        return state

    def update_packet(self, session_id: str, document_ids: list[str], renter_note: str | None) -> SessionState:
        with self.repository.transaction():
            state = self._load(session_id)
            known = {document.id: document for document in state.documents}
            if any(document_id not in known for document_id in document_ids):
                raise ServiceError("Packet contains a document outside this session", 404)
            if any(known[document_id].status != "active" for document_id in document_ids):
                raise ServiceError("Only active documents can be selected for the packet", 409)
            state.packet = PacketState(included_document_ids=_dedupe(document_ids), renter_note=renter_note)
            self._recompute_packet(state)
            state.updated_at = utc_now()
            self.repository.save(state)
        self._audit_best_effort(session_id, "packet_selection_updated", state.packet.included_document_ids)
        return state

    def stage_replacement(self, session_id: str, document_id: str, file_name: str, data: bytes) -> SessionState:
        if len(data) > self.settings.max_upload_bytes:
            raise ServiceError("Uploaded file is too large", 413)
        with self.repository.transaction():
            state = self._load(session_id)
            self._replacement_target(state, document_id)
        replacement_id = str(uuid.uuid4())
        try:
            result = extract_document(
                data,
                Path(file_name).name or "replacement.pdf",
                self.settings,
                document_id=replacement_id,
                allow_vision=False,
            )
        except ExtractionError as exc:
            raise ServiceError(f"Replacement extraction failed: {exc}", 422) from exc
        replacement = result.document
        if any(
            field.extracted_value is None
            or field.page is None
            or field.bbox is None
            or field.bbox_units != BBOX_UNITS
            or field.method not in {"text_layer", "ocr"}
            for field in replacement.fields
        ):
            raise ServiceError("Replacement extraction failed: all required local fields and source boxes are required", 422)
        try:
            verify_rendered_text_layer(replacement, result.page_images)
        except ExtractionError as exc:
            raise ServiceError(f"Replacement extraction failed: {exc}", 422) from exc
        with self.repository.transaction():
            state = self._load(session_id)
            target = self._replacement_target(state, document_id)
            if replacement.document_type != target.document_type:
                raise ServiceError("Replacement document has the wrong document type", 422)
            self._validate_replacement_identity(state, target, replacement)
            self._validate_replacement_source(state, target, replacement)
            replacement.status = "pending_replacement"
            replacement.replaces_document_id = target.id
            assets_staged = False
            try:
                self.repository.append_document(
                    state.id,
                    replacement,
                    result.source_bytes,
                    result.page_images,
                    audit=False,
                )
                assets_staged = True
                state.documents.append(replacement)
                state.updated_at = utc_now()
                self._recompute_packet(state)
                self.repository.save(state)
            except Exception as exc:
                if assets_staged:
                    self.repository.remove_document_assets(state.id, replacement.id)
                if isinstance(exc, ServiceError):
                    raise
                raise ServiceError("Replacement could not be staged", 422) from exc
        self._audit_best_effort(state.id, "replacement_staged", [target.id, replacement.id])
        return state

    def confirm_replacement(self, session_id: str, pending_document_id: str) -> SessionState:
        with self.repository.transaction():
            state = self._load(session_id)
            pending = next((document for document in state.documents if document.id == pending_document_id), None)
            if pending is None:
                raise ServiceError("Pending replacement was not found", 404)
            if pending.status != "pending_replacement" or pending.replaces_document_id is None:
                raise ServiceError("Document is not a pending replacement", 409)
            old = next((document for document in state.documents if document.id == pending.replaces_document_id), None)
            if old is None or old.status != "active":
                raise ServiceError("Replacement target is no longer active", 409)
            self._validate_replacement_identity(state, old, pending)
            self._validate_replacement_source(state, old, pending)
            previous_issues = list(state.analysis.review_issues) if state.analysis else []
            previous_issue_ids = {issue.issue_id for issue in previous_issues}
            for field in pending.fields:
                if field.confirmed:
                    continue
                if field.extracted_value is None:
                    raise ServiceError("Pending replacement has an unresolved field", 422)
                field.confirmed = True
                field.confirmed_value = field.extracted_value
            timestamp = utc_now()
            pending.status = "active"
            old.status = "superseded"
            old.superseded_by_document_id = pending.id
            old.superseded_at = timestamp
            if old.id in state.packet.included_document_ids:
                state.packet.included_document_ids = [
                    pending.id if document_id == old.id else document_id
                    for document_id in state.packet.included_document_ids
                ]
            self._reanalyze(state)
            self._recompute_packet(state)
            current_issue_ids = {issue.issue_id for issue in state.analysis.review_issues} if state.analysis else set()
            resolved_issue_ids = previous_issue_ids - current_issue_ids
            state.replacement_events.append(
                ReplacementEvent(
                    old_document_id=old.id,
                    new_document_id=pending.id,
                    timestamp=timestamp,
                    resolved_issue_ids=sorted(resolved_issue_ids),
                    resolved_issues=[issue for issue in previous_issues if issue.issue_id in resolved_issue_ids],
                )
            )
            state.updated_at = timestamp
            self.repository.save(state)
        self._audit_best_effort(session_id, "replacement_confirmed", [old.id, pending.id])
        return state

    def answer_question(self, session_id: str, question: str) -> dict[str, Any]:
        state = self._load(session_id)
        context = {
            "analysis": state.analysis,
            "household_size": state.analysis.household_size if state.analysis else self._current_household_size(state),
            "current_household_id": self._current_household_id(state),
        }
        decision = route_question(question, context)
        citations = self.rules.citations(decision["rule_ids"])
        decision["question"] = question
        decision["rule_citations"] = citations
        decision["citations"] = citations
        decision["refused"] = decision["refusal"]
        self._audit_best_effort(session_id, "question_answered")
        return decision

    def packet_zip(self, session_id: str) -> bytes:
        with self.repository.transaction():
            state = self._load(session_id)
            household_id = self._current_household_id(state) or f"RENTER-{state.id[:8].upper()}"
            return build_packet_zip(state, self.repository, household_id)

    def page_png(self, session_id: str, document_id: str, page_number: int) -> bytes:
        state = self._load(session_id)
        document = next((item for item in state.documents if item.id == document_id), None)
        if document is None or page_number > document.page_count:
            raise ServiceError("Document or page not found", 404)
        try:
            return self.repository.page_path(session_id, document_id, page_number).read_bytes()
        except (SessionNotFound, InvalidIdentifier) as exc:
            raise ServiceError("Document or page not found", 404) from exc

    def delete_session(self, session_id: str) -> dict[str, Any]:
        self._load(session_id)
        try:
            self.repository.delete(session_id)
        except SessionNotFound as exc:
            raise ServiceError("Session not found", 404) from exc
        return {
            "id": session_id,
            "deleted": True,
            "deleted_at": utc_now(),
            "artifacts_removed": ["uploads", "rendered_pages", "fields", "audit", "packet"],
        }

    def _load(self, session_id: str) -> SessionState:
        try:
            with self.repository.transaction():
                state, migrated = self.repository.load_with_migration(session_id)
                if migrated:
                    self._recover_legacy_source_names(state)
                    self._reanalyze(state)
                    self._recompute_packet(state)
                    state.updated_at = utc_now()
                    self.repository.save(state)
                return state
        except (SessionNotFound, InvalidIdentifier) as exc:
            raise ServiceError("Session not found", 404) from exc

    def _recover_legacy_source_names(self, state: SessionState) -> None:
        applicable_types = {"pay_stub", "employment_letter", "benefit_letter", "gig_statement"}
        for document in state.documents:
            if document.document_type not in applicable_types or _field(document, "source_name") is not None:
                continue
            confirmed = bool(document.fields) and all(field.confirmed for field in document.fields)
            recovered: FieldRecord | None = None
            try:
                source = self.repository.source_path(state.id, document.id).read_bytes()
                result = extract_document(
                    source,
                    document.file_name,
                    self.settings,
                    document_id=document.id,
                    expected_type=document.document_type,
                    allow_vision=False,
                )
                extracted = _field(result.document, "source_name")
                if extracted is not None and extracted.extracted_value is not None:
                    recovered = extracted.model_copy(deep=True)
                    recovered.confirmed = confirmed
                    recovered.confirmed_value = recovered.extracted_value if confirmed else None
            except (ExtractionError, OSError, SessionNotFound):
                recovered = None
            if recovered is None:
                recovered = FieldRecord(
                    id=f"{document.id}:source_name",
                    name="source_name",
                    label="Employer or source",
                    value_type="string",
                    extracted_value=None,
                    confirmed_value=None,
                    confirmed=False,
                    confidence=0,
                    method="unresolved",
                    document_id=document.id,
                )
            document.fields.append(recovered)

    def _replacement_target(self, state: SessionState, document_id: str) -> DocumentRecord:
        target = next((document for document in state.documents if document.id == document_id), None)
        if target is None:
            raise ServiceError("Replacement target was not found", 404)
        if target.status != "active":
            raise ServiceError("Only an active document can be replaced", 409)
        if any(
            document.status == "pending_replacement" and document.replaces_document_id == target.id
            for document in state.documents
        ):
            raise ServiceError("A replacement is already pending for this document", 409)
        return target

    def _audit_best_effort(
        self,
        session_id: str,
        action: str,
        document_ids: list[str] | None = None,
    ) -> None:
        try:
            self.repository.audit(session_id, action, document_ids)
        except Exception as exc:
            logger.warning("Audit append failed after %s commit (%s)", action, type(exc).__name__)

    def _resolve_field(self, state: SessionState, field_id: str) -> tuple[DocumentRecord, FieldRecord]:
        all_fields = [(document, field) for document in state.documents for field in document.fields]
        exact = next((pair for pair in all_fields if pair[1].id == field_id), None)
        if exact is not None:
            return exact
        by_name = [pair for pair in all_fields if pair[1].name == field_id]
        if len(by_name) == 1:
            return by_name[0]
        raise ServiceError("Field not found in this session", 404)

    def _validate_replacement_identity(
        self,
        state: SessionState,
        target: DocumentRecord,
        replacement: DocumentRecord,
    ) -> None:
        replacement_person = _normalized_text(_effective_value(replacement, "person_name"))
        target_person = _normalized_text(_effective_value(target, "person_name"))
        application_people = {
            person
            for document in _active_documents(state)
            if document.document_type == "application_summary"
            if (person := _normalized_text(_effective_value(document, "person_name"))) is not None
        }
        if replacement_person is None or replacement_person != target_person or (
            application_people and replacement_person not in application_people
        ):
            raise ServiceError("Replacement document has the wrong person or household", 422)

    def _wage_signature(self, document: DocumentRecord) -> tuple[str, str | None, float, float] | None:
        person = _normalized_text(_effective_value(document, "person_name"))
        source = _normalized_text(_effective_value(document, "source_name"))
        rate = _effective_value(document, "hourly_rate")
        if person is None or not isinstance(rate, (int, float)):
            return None
        if document.document_type == "pay_stub":
            hours = _effective_value(document, "regular_hours")
            frequency = _effective_value(document, "pay_frequency")
            if not isinstance(hours, (int, float)) or not isinstance(frequency, str):
                return None
            try:
                annual_amount = annualize(float(hours) * float(rate), frequency)
            except ValueError:
                return None
        elif document.document_type == "employment_letter":
            hours = _effective_value(document, "weekly_hours")
            if not isinstance(hours, (int, float)):
                return None
            annual_amount = annualize(float(hours) * float(rate), "weekly")
        else:
            return None
        return person, source, round(float(rate), 2), round(annual_amount, 2)

    def _source_signature(self, document: DocumentRecord) -> tuple[Any, ...] | None:
        person = _normalized_text(_effective_value(document, "person_name"))
        source = _normalized_text(_effective_value(document, "source_name"))
        if person is None or source is None:
            return None
        if document.document_type == "benefit_letter":
            return (
                person,
                source,
                _effective_value(document, "monthly_benefit"),
                _effective_value(document, "benefit_frequency"),
            )
        if document.document_type == "gig_statement":
            return (
                person,
                source,
                _effective_value(document, "gross_receipts"),
                _effective_value(document, "platform_fees"),
            )
        return None

    def _validate_replacement_source(
        self,
        state: SessionState,
        target: DocumentRecord,
        replacement: DocumentRecord,
    ) -> None:
        if target.document_type in {"pay_stub", "employment_letter"}:
            target_signature = self._wage_signature(target)
            replacement_signature = self._wage_signature(replacement)
            base_matches = bool(
                target_signature
                and replacement_signature
                and replacement_signature[1] is not None
                and target_signature[0] == replacement_signature[0]
                and target_signature[2:] == replacement_signature[2:]
            )
            if base_matches and target_signature[1] is not None:
                if target_signature[1] == replacement_signature[1]:
                    return
                raise ServiceError("Replacement document has the wrong employer or income source", 422)
            corroborated = False
            if base_matches and replacement_signature is not None:
                for document in _active_documents(state):
                    if document.id == target.id or document.document_type not in {"pay_stub", "employment_letter"}:
                        continue
                    evidence = self._wage_signature(document)
                    if (
                        evidence
                        and evidence[0] == replacement_signature[0]
                        and evidence[1] == replacement_signature[1]
                        and evidence[2:] == replacement_signature[2:]
                    ):
                        corroborated = True
                        break
            if not base_matches or not corroborated:
                raise ServiceError("Replacement document has the wrong employer or income source", 422)
            return
        if self._source_signature(replacement) != self._source_signature(target):
            raise ServiceError("Replacement document has the wrong employer or income source", 422)

    def _coerce_field_value(self, field: FieldRecord, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, (dict, list)):
            raise ServiceError("Field corrections must be JSON scalars", 422)
        if field.value_type == "string":
            if not isinstance(value, str) or not value.strip():
                raise ServiceError("Expected a non-empty string", 422)
            return value.strip()
        if field.value_type == "integer":
            if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
                raise ServiceError("Expected an integer", 422)
            if int(value) < 0:
                raise ServiceError("Value must be non-negative", 422)
            return int(value)
        if field.value_type == "number":
            if isinstance(value, bool) or not isinstance(value, (int, float)) or float(value) < 0:
                raise ServiceError("Expected a non-negative number", 422)
            return round(float(value), 2)
        if field.value_type == "frequency":
            if not isinstance(value, str) or value.lower() not in {"weekly", "biweekly", "semimonthly", "monthly", "annual"}:
                raise ServiceError("Unsupported pay frequency", 422)
            return value.lower()
        if field.value_type == "date":
            if not isinstance(value, str) or _as_date(value) is None:
                raise ServiceError("Expected an ISO date", 422)
            return value
        if field.value_type == "month":
            if not isinstance(value, str) or _as_date(value, month=True) is None or not re.fullmatch(r"\d{4}-\d{2}", value):
                raise ServiceError("Expected an ISO year-month", 422)
            return value
        raise ServiceError("Unsupported field type", 422)

    def _reanalyze(self, state: SessionState) -> None:
        fields = [field for document in _active_documents(state) for field in document.fields]
        state.all_fields_confirmed = bool(fields) and all(field.confirmed and field.confirmed_value is not None for field in fields)
        state.analysis = self._analyze(state) if state.all_fields_confirmed else None

    def _recompute_packet(self, state: SessionState) -> None:
        active_ids = [document.id for document in _active_documents(state)]
        included = set(state.packet.included_document_ids)
        state.packet.included_document_ids = [document_id for document_id in active_ids if document_id in included]
        state.packet.excluded_active_document_ids = [document_id for document_id in active_ids if document_id not in included]
        state.packet.packet_complete = not state.packet.excluded_active_document_ids

    def _current_household_id(self, state: SessionState) -> str | None:
        for document in _active_documents(state):
            match = re.match(r"^(HH-\d{3})-D\d{2}$", document.id, flags=re.IGNORECASE)
            if match:
                return match.group(1).upper()
        return None

    def _current_household_size(self, state: SessionState) -> int | None:
        for document in _active_documents(state):
            if document.document_type == "application_summary":
                value = _value(document, "household_size")
                if isinstance(value, int):
                    return value
        return None

    def _review_issue(
        self,
        code: str,
        message: str,
        *,
        document_ids: Iterable[str] = (),
        field_ids: Iterable[str] = (),
        rule_ids: Iterable[str] = ("CH-READINESS-001",),
        action_type: str,
        action_document_id: str | None,
        action_label: str,
    ) -> ReviewIssue:
        affected_document_ids = _dedupe(document_ids)
        affected_field_ids = _dedupe(field_ids)
        linked_rule_ids = _dedupe(rule_ids)
        stable_payload = json.dumps(
            {
                "code": code,
                "documents": affected_document_ids,
                "fields": affected_field_ids,
                "rules": linked_rule_ids,
                "action": [action_type, action_document_id],
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        issue_id = f"issue-{hashlib.sha256(stable_payload.encode('utf-8')).hexdigest()[:20]}"
        return ReviewIssue(
            issue_id=issue_id,
            code=code,
            message=message,
            affected_document_ids=affected_document_ids,
            affected_field_ids=affected_field_ids,
            rule_ids=linked_rule_ids,
            action=ReviewAction(type=action_type, document_id=action_document_id, label=action_label),
        )

    def _analyze(self, state: SessionState) -> Analysis:
        issues: list[ReviewIssue] = []
        documents = _active_documents(state)
        app_docs = [document for document in documents if document.document_type == "application_summary"]
        if not app_docs:
            issues.append(
                self._review_issue(
                    "MISSING_APPLICATION_SUMMARY",
                    "An application summary is required for human review.",
                    action_type="add_document",
                    action_document_id=None,
                    action_label="Add document",
                )
            )
        for document in app_docs:
            application_date = _as_date(_value(document, "application_date"))
            if application_date is None or not is_current(application_date, self.settings.event_date):
                field = _field(document, "application_date")
                issues.append(
                    self._review_issue(
                        "APPLICATION_SUMMARY_EXPIRED",
                        "The application summary needs a current replacement under the frozen 60-day convention.",
                        document_ids=[document.id],
                        field_ids=[field.id] if field else [],
                        action_type="replace_document",
                        action_document_id=document.id,
                        action_label="Replace document",
                    )
                )
        household_values = [
            _value(document, "household_size") for document in app_docs if _value(document, "household_size") is not None
        ]
        household_size = household_values[0] if household_values else None
        if any(value != household_size for value in household_values[1:]):
            issues.append(
                self._review_issue(
                    "HOUSEHOLD_SIZE_CONFLICT",
                    "The application summaries contain conflicting household sizes.",
                    document_ids=[document.id for document in app_docs],
                    field_ids=[field.id for document in app_docs if (field := _field(document, "household_size"))],
                    action_type="review_document",
                    action_document_id=app_docs[0].id,
                    action_label="Review documents",
                )
            )
        if household_size is None:
            issues.append(
                self._review_issue(
                    "MISSING_REQUIRED_FIELD",
                    "A confirmed household size is required.",
                    document_ids=[document.id for document in app_docs],
                    field_ids=[field.id for document in app_docs if (field := _field(document, "household_size"))],
                    action_type="correct_field",
                    action_document_id=app_docs[0].id if app_docs else None,
                    action_label="Correct field",
                )
            )

        for document in documents:
            for item in document.fields:
                if not item.confirmed or item.confirmed_value is None:
                    issues.append(
                        self._review_issue(
                            "MISSING_REQUIRED_FIELD",
                            f"{item.label} needs a confirmed value.",
                            document_ids=[document.id],
                            field_ids=[item.id],
                            action_type="correct_field",
                            action_document_id=document.id,
                            action_label="Correct field",
                        )
                    )
                citation_missing = item.bbox is None or item.bbox_units != BBOX_UNITS or item.page is None
                if not citation_missing and item.page is not None:
                    if item.page > document.page_count:
                        citation_missing = True
                    else:
                        try:
                            validate_bbox(item.bbox)
                        except ValueError:
                            citation_missing = True
                if citation_missing:
                    issues.append(
                        self._review_issue(
                            "MISSING_CITATION",
                            f"{item.label} needs a valid page-level source box.",
                            document_ids=[document.id],
                            field_ids=[item.id],
                            action_type="review_document",
                            action_document_id=document.id,
                            action_label="Review source",
                        )
                    )

        source_groups: list[dict[str, Any]] = []
        pay_groups: dict[tuple[Any, ...], dict[str, Any]] = {}
        pay_docs = [document for document in documents if document.document_type == "pay_stub"]
        if not pay_docs:
            issues.append(
                self._review_issue(
                    "MISSING_PAY_STUB",
                    "At least one current pay stub is required for wage evidence.",
                    action_type="add_document",
                    action_document_id=None,
                    action_label="Add document",
                )
            )
        for document in pay_docs:
            person = _value(document, "person_name")
            source = _value(document, "source_name")
            hours = _value(document, "regular_hours")
            rate = _value(document, "hourly_rate")
            frequency = _value(document, "pay_frequency")
            gross = _value(document, "gross_pay")
            pay_date_field = _field(document, "pay_date")
            pay_date = _as_date(_value(document, "pay_date"))
            if pay_date is None or not is_current(pay_date, self.settings.event_date):
                issues.append(
                    self._review_issue(
                        "PAY_STUB_EXPIRED",
                        "This pay stub needs replacement under the frozen 60-day convention.",
                        document_ids=[document.id],
                        field_ids=[pay_date_field.id] if pay_date_field else [],
                        action_type="replace_document",
                        action_document_id=document.id,
                        action_label="Replace document",
                    )
                )
            if person is None or hours is None or rate is None or frequency is None:
                continue
            regular_amount = round(float(hours) * float(rate), 2)
            if gross is not None and round(float(gross), 2) != regular_amount:
                conflict_fields = [
                    field.id
                    for name in ("regular_hours", "hourly_rate", "gross_pay")
                    if (field := _field(document, name)) is not None
                ]
                issues.append(
                    self._review_issue(
                        "PAY_STUB_TOTAL_CONFLICT",
                        "The pay stub gross pay does not match regular hours multiplied by hourly rate.",
                        document_ids=[document.id],
                        field_ids=conflict_fields,
                        rule_ids=["CH-INCOME-001", "CH-READINESS-001"],
                        action_type="review_document",
                        action_document_id=document.id,
                        action_label="Review document",
                    )
                )
            try:
                annual_amount = annualize(regular_amount, str(frequency))
            except ValueError:
                frequency_field = _field(document, "pay_frequency")
                issues.append(
                    self._review_issue(
                        "MISSING_REQUIRED_FIELD",
                        "Pay frequency must use a supported recurring frequency.",
                        document_ids=[document.id],
                        field_ids=[frequency_field.id] if frequency_field else [],
                        rule_ids=["CH-INCOME-001", "CH-READINESS-001"],
                        action_type="correct_field",
                        action_document_id=document.id,
                        action_label="Correct field",
                    )
                )
                continue
            key = (str(person), str(source), regular_amount, str(frequency), round(float(rate), 2))
            group = pay_groups.setdefault(
                key,
                {
                    "source_type": "wage",
                    "person": str(person),
                    "source": str(source),
                    "amount": regular_amount,
                    "frequency": str(frequency),
                    "annualized_amount": annual_amount,
                    "document_ids": [],
                    "corroborating_document_ids": [],
                    "corroborated": True,
                    "basis": "regular_hours * hourly_rate, annualized once from explicit pay frequency",
                    "citations": [],
                },
            )
            group["document_ids"].append(document.id)
            group["citations"].extend(
                _citation(document, ("regular_hours", "hourly_rate", "pay_frequency", "gross_pay", "source_name"))
            )
        source_groups.extend(pay_groups.values())

        employment_docs = [document for document in documents if document.document_type == "employment_letter"]
        for document in employment_docs:
            person = _value(document, "person_name")
            source = _value(document, "source_name")
            hours = _value(document, "weekly_hours")
            rate = _value(document, "hourly_rate")
            if person is None or hours is None or rate is None:
                continue
            weekly_amount = round(float(hours) * float(rate), 2)
            annual_amount = annualize(weekly_amount, "weekly")
            date_field = _field(document, "document_date")
            document_date = _as_date(_value(document, "document_date"))
            if document_date is None or not is_current(document_date, self.settings.event_date):
                issues.append(
                    self._review_issue(
                        "EMPLOYMENT_LETTER_EXPIRED",
                        "Under the challenge\u2019s frozen 60-day document-freshness convention, this employment letter needs replacement.",
                        document_ids=[document.id],
                        field_ids=[date_field.id] if date_field else [],
                        action_type="replace_document",
                        action_document_id=document.id,
                        action_label="Replace document",
                    )
                )
            matched = next(
                (
                    group
                    for group in source_groups
                    if group["source_type"] == "wage"
                    and group["person"] == str(person)
                    and group["source"] == str(source)
                    and group["annualized_amount"] == annual_amount
                ),
                None,
            )
            if matched is not None:
                matched["corroborating_document_ids"].append(document.id)
                matched["citations"].extend(
                    _citation(document, ("weekly_hours", "hourly_rate", "document_date", "source_name"))
                )
                continue
            source_groups.append(
                {
                    "source_type": "employment_wage",
                    "person": str(person),
                    "source": str(source),
                    "amount": weekly_amount,
                    "frequency": "weekly",
                    "annualized_amount": annual_amount,
                    "document_ids": [document.id],
                    "corroborating_document_ids": [],
                    "corroborated": False,
                    "basis": "weekly_hours * hourly_rate, annualized weekly",
                    "citations": _citation(document, ("weekly_hours", "hourly_rate", "document_date", "source_name")),
                }
            )
            issues.append(
                self._review_issue(
                    "EMPLOYMENT_INCOME_UNCORROBORATED",
                    "The employment letter wage amount is not corroborated by active wage evidence.",
                    document_ids=[document.id],
                    field_ids=[
                        field.id
                        for name in ("weekly_hours", "hourly_rate", "source_name")
                        if (field := _field(document, name)) is not None
                    ],
                    rule_ids=["CH-INCOME-001", "CH-READINESS-001"],
                    action_type="review_document",
                    action_document_id=document.id,
                    action_label="Review document",
                )
            )

        benefit_groups: dict[tuple[Any, ...], dict[str, Any]] = {}
        for document in documents:
            if document.document_type != "benefit_letter":
                continue
            person = _value(document, "person_name")
            source = _value(document, "source_name")
            amount = _value(document, "monthly_benefit")
            frequency = _value(document, "benefit_frequency")
            if person is None or amount is None or frequency is None:
                continue
            try:
                annual_amount = annualize(float(amount), str(frequency))
            except ValueError:
                frequency_field = _field(document, "benefit_frequency")
                issues.append(
                    self._review_issue(
                        "MISSING_REQUIRED_FIELD",
                        "Benefit frequency must use a supported recurring frequency.",
                        document_ids=[document.id],
                        field_ids=[frequency_field.id] if frequency_field else [],
                        rule_ids=["CH-INCOME-001", "CH-READINESS-001"],
                        action_type="correct_field",
                        action_document_id=document.id,
                        action_label="Correct field",
                    )
                )
                continue
            key = (str(person), str(source), round(float(amount), 2), str(frequency))
            group = benefit_groups.setdefault(
                key,
                {
                    "source_type": "benefit",
                    "person": str(person),
                    "amount": round(float(amount), 2),
                    "frequency": str(frequency),
                    "annualized_amount": annual_amount,
                    "document_ids": [],
                    "corroborating_document_ids": [],
                    "corroborated": True,
                    "basis": "confirmed recurring benefit amount and explicit frequency",
                    "citations": [],
                },
            )
            group["document_ids"].append(document.id)
            group["citations"].extend(
                _citation(document, ("monthly_benefit", "benefit_frequency", "document_date", "source_name"))
            )
            benefit_date_field = _field(document, "document_date")
            benefit_date = _as_date(_value(document, "document_date"))
            if benefit_date is None or not is_current(benefit_date, self.settings.event_date):
                issues.append(
                    self._review_issue(
                        "BENEFIT_LETTER_EXPIRED",
                        "This benefit letter needs replacement under the frozen 60-day convention.",
                        document_ids=[document.id],
                        field_ids=[benefit_date_field.id] if benefit_date_field else [],
                        action_type="replace_document",
                        action_document_id=document.id,
                        action_label="Replace document",
                    )
                )
        source_groups.extend(benefit_groups.values())

        gig_groups: dict[tuple[Any, ...], dict[str, Any]] = {}
        gig_document_ids: list[str] = []
        gig_field_ids: list[str] = []
        for document in documents:
            if document.document_type != "gig_statement":
                continue
            person = _value(document, "person_name")
            source = _value(document, "source_name")
            month = _value(document, "statement_month")
            receipts = _value(document, "gross_receipts")
            if person is None or month is None or receipts is None:
                continue
            annual_amount = annualize(float(receipts), "monthly")
            key = (str(person), str(source), str(month))
            group = gig_groups.setdefault(
                key,
                {
                    "source_type": "gig",
                    "person": str(person),
                    "amount": round(float(receipts), 2),
                    "frequency": "monthly",
                    "annualized_amount": annual_amount,
                    "document_ids": [],
                    "corroborating_document_ids": [],
                    "corroborated": False,
                    "basis": "gross receipts annualized monthly; platform fees are not subtracted",
                    "citations": [],
                },
            )
            group["document_ids"].append(document.id)
            gig_document_ids.append(document.id)
            gig_field_ids.extend(
                field.id
                for name in ("gross_receipts", "statement_month", "platform_fees", "source_name")
                if (field := _field(document, name)) is not None
            )
            group["citations"].extend(
                _citation(document, ("gross_receipts", "statement_month", "platform_fees", "source_name"))
            )
        if gig_document_ids:
            issues.append(
                self._review_issue(
                    "GIG_INCOME_UNCORROBORATED",
                    "The gig income statement is not corroborated by another active source.",
                    document_ids=gig_document_ids,
                    field_ids=gig_field_ids,
                    rule_ids=["CH-INCOME-001", "CH-READINESS-001"],
                    action_type="review_document",
                    action_document_id=gig_document_ids[0],
                    action_label="Review document",
                )
            )
        source_groups.extend(gig_groups.values())

        application_people = {
            str(value)
            for document in app_docs
            if (value := _value(document, "person_name")) is not None
        }
        income_people = {str(group["person"]) for group in source_groups if group.get("person") is not None}
        if application_people and any(person not in application_people for person in income_people):
            affected_documents = [
                document.id
                for document in documents
                if document.document_type != "application_summary"
                and (person := _value(document, "person_name")) is not None
                and str(person) not in application_people
            ]
            issues.append(
                self._review_issue(
                    "HOUSEHOLD_IDENTITY_CONFLICT",
                    "Income evidence names a person not present on the active application summary.",
                    document_ids=[document.id for document in app_docs] + affected_documents,
                    field_ids=[
                        field.id
                        for document in documents
                        if (field := _field(document, "person_name")) is not None
                    ],
                    action_type="review_document",
                    action_document_id=affected_documents[0] if affected_documents else app_docs[0].id,
                    action_label="Review documents",
                )
            )

        source_models: list[IncomeSource] = []
        annualized_income = 0.0
        for index, group in enumerate(source_groups, start=1):
            group["document_ids"] = _dedupe(group["document_ids"])
            group["corroborating_document_ids"] = _dedupe(group["corroborating_document_ids"])
            group["corroborated"] = bool(group["corroborated"] or group["corroborating_document_ids"])
            annualized_income += float(group["annualized_amount"])
            source_models.append(
                IncomeSource(
                    source_id=_source_id(group["source_type"], index),
                    source_type=group["source_type"],
                    document_ids=group["document_ids"],
                    corroborating_document_ids=group["corroborating_document_ids"],
                    amount=group["amount"],
                    frequency=group["frequency"],
                    annualized_amount=group["annualized_amount"],
                    basis=group["basis"],
                    corroborated=group["corroborated"],
                    citations=group["citations"],
                )
            )
        annualized_income = round(annualized_income, 2)
        if not source_models:
            issues.append(
                self._review_issue(
                    "NO_CONFIRMED_INCOME",
                    "No confirmed recurring income source is available for calculation.",
                    rule_ids=["CH-INCOME-001", "CH-READINESS-001"],
                    action_type="add_document",
                    action_document_id=None,
                    action_label="Add document",
                )
            )

        threshold = THRESHOLDS.get(household_size) if isinstance(household_size, int) else None
        if threshold is None:
            household_fields = [field.id for document in app_docs if (field := _field(document, "household_size"))]
            issues.append(
                self._review_issue(
                    "NO_FROZEN_THRESHOLD",
                    "No frozen threshold exists for the confirmed household size.",
                    document_ids=[document.id for document in app_docs],
                    field_ids=household_fields,
                    rule_ids=["HUD-MTSP-002", "CH-READINESS-001"],
                    action_type="correct_field",
                    action_document_id=app_docs[0].id if app_docs else None,
                    action_label="Correct household size",
                )
            )
            comparison = "no_frozen_threshold"
            arithmetic_difference = None
        else:
            comparison = compare_to_threshold(annualized_income, threshold)
            arithmetic_difference = round(float(threshold) - annualized_income, 2)

        readiness_status = "READY_TO_REVIEW" if not issues else "NEEDS_REVIEW"
        rule_ids = ["HUD-MTSP-002", "CH-INCOME-001", "CH-READINESS-001", "CH-DECISION-001"]
        decision_boundary = (
            "Ready for human review. No program determination was made."
            if readiness_status == "READY_TO_REVIEW"
            else "Human review is required. No program determination was made."
        )
        return Analysis(
            household_size=household_size,
            annualized_income=annualized_income,
            threshold=threshold,
            comparison=comparison,
            arithmetic_difference=arithmetic_difference,
            readiness_status=readiness_status,
            review_issues=issues,
            income_sources=source_models,
            rule_citations=self.rules.citations(rule_ids),
            decision_boundary=decision_boundary,
        )
