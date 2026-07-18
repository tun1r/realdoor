"""Application services: confirmation, reconciliation, readiness, and demos."""

from __future__ import annotations

import csv
import re
import uuid
from datetime import date
from pathlib import Path
from typing import Any, Iterable

from .calculations import annualize, compare_to_threshold
from .config import Settings
from .coordinates import BBOX_UNITS, validate_bbox
from .extraction import ExtractionError, ExtractionResult, extract_document
from .freshness import is_current
from .models import (
    Analysis,
    ConfirmRequest,
    CorrectionRecord,
    DocumentRecord,
    FieldRecord,
    IncomeSource,
    PacketState,
    SessionState,
    utc_now,
)
from .packet import build_packet_zip
from .rules import THRESHOLDS, RuleStore
from .safety import route_question
from .storage import InvalidIdentifier, SessionNotFound, SessionRepository, validate_document_id


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
            self.repository.append_document(session_id, result.document, result.source_bytes, result.page_images)
            state = self.repository.load(session_id)
            state.documents.append(result.document)
            if result.document.id not in state.packet.included_document_ids:
                state.packet.included_document_ids.append(result.document.id)
            state.updated_at = utc_now()
            self._reanalyze(state)
            self.repository.save(state)
            return result.document
        except (ExtractionError, InvalidIdentifier) as exc:
            raise ServiceError(str(exc), 422) from exc
        except SessionNotFound as exc:
            raise ServiceError("Session not found", 404) from exc

    def get_session(self, session_id: str) -> SessionState:
        return self._load(session_id)

    def confirm(self, session_id: str, request: ConfirmRequest) -> SessionState:
        state = self._load(session_id)
        if request.field_ids is None:
            targets = [field for document in state.documents for field in document.fields]
        else:
            targets = [self._resolve_field(state, field_id) for field_id in request.field_ids]
        for item in targets:
            if item.extracted_value is None:
                continue
            item.confirmed_value = item.extracted_value
            item.confirmed = True
        state.updated_at = utc_now()
        self._reanalyze(state)
        self.repository.save(state)
        self.repository.audit(session_id, "fields_confirmed")
        return state

    def correct_field(self, session_id: str, field_id: str, value: Any, confirmed: bool = True) -> SessionState:
        state = self._load(session_id)
        item = self._resolve_field(state, field_id)
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
        self.repository.audit(session_id, "field_corrected")
        return state

    def update_packet(self, session_id: str, document_ids: list[str], renter_note: str | None) -> SessionState:
        state = self._load(session_id)
        known = {document.id for document in state.documents}
        if any(document_id not in known for document_id in document_ids):
            raise ServiceError("Packet contains a document outside this session", 404)
        state.packet = PacketState(included_document_ids=_dedupe(document_ids), renter_note=renter_note)
        state.updated_at = utc_now()
        self.repository.save(state)
        self.repository.audit(session_id, "packet_selection_updated", state.packet.included_document_ids)
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
        self.repository.audit(session_id, "question_answered")
        return decision

    def packet_zip(self, session_id: str) -> bytes:
        state = self._load(session_id)
        selected_ids = set(state.packet.included_document_ids)
        packet_state = state.model_copy(deep=True)
        packet_state.documents = [document for document in packet_state.documents if document.id in selected_ids]
        self._reanalyze(packet_state)
        household_id = self._current_household_id(state) or f"RENTER-{state.id[:8].upper()}"
        return build_packet_zip(packet_state, self.repository, household_id)

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
            return self.repository.load(session_id)
        except (SessionNotFound, InvalidIdentifier) as exc:
            raise ServiceError("Session not found", 404) from exc

    def _resolve_field(self, state: SessionState, field_id: str) -> FieldRecord:
        all_fields = [field for document in state.documents for field in document.fields]
        exact = next((field for field in all_fields if field.id == field_id), None)
        if exact is not None:
            return exact
        by_name = [field for field in all_fields if field.name == field_id]
        if len(by_name) == 1:
            return by_name[0]
        raise ServiceError("Field not found in this session", 404)

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
        fields = [field for document in state.documents for field in document.fields]
        state.all_fields_confirmed = bool(fields) and all(field.confirmed and field.confirmed_value is not None for field in fields)
        state.analysis = self._analyze(state) if state.all_fields_confirmed else None

    def _current_household_id(self, state: SessionState) -> str | None:
        for document in state.documents:
            match = re.match(r"^(HH-\d{3})-D\d{2}$", document.id, flags=re.IGNORECASE)
            if match:
                return match.group(1).upper()
        return None

    def _current_household_size(self, state: SessionState) -> int | None:
        for document in state.documents:
            if document.document_type == "application_summary":
                value = _value(document, "household_size")
                if isinstance(value, int):
                    return value
        return None

    def _analyze(self, state: SessionState) -> Analysis:
        reasons: list[str] = []
        app_docs = [document for document in state.documents if document.document_type == "application_summary"]
        if not app_docs:
            reasons.append("MISSING_APPLICATION_SUMMARY")
        for document in app_docs:
            application_date = _as_date(_value(document, "application_date"))
            if application_date is None or not is_current(application_date, self.settings.event_date):
                reasons.append("APPLICATION_SUMMARY_EXPIRED")
        household_values = [
            _value(document, "household_size") for document in app_docs if _value(document, "household_size") is not None
        ]
        household_size = household_values[0] if household_values else None
        if any(value != household_size for value in household_values[1:]):
            reasons.append("HOUSEHOLD_SIZE_CONFLICT")
        if household_size is None:
            reasons.append("MISSING_REQUIRED_FIELD")

        for document in state.documents:
            for item in document.fields:
                if not item.confirmed or item.confirmed_value is None:
                    reasons.append("MISSING_REQUIRED_FIELD")
                if item.bbox is None or item.bbox_units != BBOX_UNITS or item.page is None:
                    reasons.append("MISSING_CITATION")
                elif item.page > document.page_count:
                    reasons.append("MISSING_CITATION")
                else:
                    try:
                        validate_bbox(item.bbox)
                    except ValueError:
                        reasons.append("MISSING_CITATION")

        source_groups: list[dict[str, Any]] = []
        pay_groups: dict[tuple[Any, ...], dict[str, Any]] = {}
        pay_docs = [document for document in state.documents if document.document_type == "pay_stub"]
        if not pay_docs:
            reasons.append("MISSING_PAY_STUB")
        for document in pay_docs:
            person = _value(document, "person_name")
            hours = _value(document, "regular_hours")
            rate = _value(document, "hourly_rate")
            frequency = _value(document, "pay_frequency")
            gross = _value(document, "gross_pay")
            pay_date = _as_date(_value(document, "pay_date"))
            if pay_date is None or not is_current(pay_date, self.settings.event_date):
                reasons.append("PAY_STUB_EXPIRED")
            if person is None or hours is None or rate is None or frequency is None:
                continue
            regular_amount = round(float(hours) * float(rate), 2)
            if gross is not None and round(float(gross), 2) != regular_amount:
                reasons.append("PAY_STUB_TOTAL_CONFLICT")
            try:
                annual_amount = annualize(regular_amount, str(frequency))
            except ValueError:
                reasons.append("MISSING_REQUIRED_FIELD")
                continue
            key = (str(person), regular_amount, str(frequency), round(float(rate), 2))
            group = pay_groups.setdefault(
                key,
                {
                    "source_type": "wage",
                    "person": str(person),
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
            group["citations"].extend(_citation(document, ("regular_hours", "hourly_rate", "pay_frequency", "gross_pay")))
        source_groups.extend(pay_groups.values())

        employment_docs = [document for document in state.documents if document.document_type == "employment_letter"]
        for document in employment_docs:
            person = _value(document, "person_name")
            hours = _value(document, "weekly_hours")
            rate = _value(document, "hourly_rate")
            if person is None or hours is None or rate is None:
                continue
            weekly_amount = round(float(hours) * float(rate), 2)
            annual_amount = annualize(weekly_amount, "weekly")
            date_value = _value(document, "document_date")
            document_date = _as_date(date_value)
            if document_date is None or not is_current(document_date, self.settings.event_date):
                reasons.append("EMPLOYMENT_LETTER_EXPIRED")
            matched = next(
                (
                    group
                    for group in source_groups
                    if group["source_type"] == "wage"
                    and group["person"] == str(person)
                    and group["annualized_amount"] == annual_amount
                ),
                None,
            )
            if matched is not None:
                matched["corroborating_document_ids"].append(document.id)
                matched["citations"].extend(_citation(document, ("weekly_hours", "hourly_rate", "document_date")))
                continue
            source_groups.append(
                {
                    "source_type": "employment_wage",
                    "person": str(person),
                    "amount": weekly_amount,
                    "frequency": "weekly",
                    "annualized_amount": annual_amount,
                    "document_ids": [document.id],
                    "corroborating_document_ids": [],
                    "corroborated": False,
                    "basis": "weekly_hours * hourly_rate, annualized weekly",
                    "citations": _citation(document, ("weekly_hours", "hourly_rate", "document_date")),
                }
            )
            reasons.append("EMPLOYMENT_INCOME_UNCORROBORATED")

        benefit_groups: dict[tuple[Any, ...], dict[str, Any]] = {}
        for document in state.documents:
            if document.document_type != "benefit_letter":
                continue
            person = _value(document, "person_name")
            amount = _value(document, "monthly_benefit")
            frequency = _value(document, "benefit_frequency")
            if person is None or amount is None or frequency is None:
                continue
            try:
                annual_amount = annualize(float(amount), str(frequency))
            except ValueError:
                reasons.append("MISSING_REQUIRED_FIELD")
                continue
            key = (str(person), round(float(amount), 2), str(frequency))
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
            group["citations"].extend(_citation(document, ("monthly_benefit", "benefit_frequency", "document_date")))
            benefit_date = _as_date(_value(document, "document_date"))
            if benefit_date is None or not is_current(benefit_date, self.settings.event_date):
                reasons.append("BENEFIT_LETTER_EXPIRED")
        source_groups.extend(benefit_groups.values())

        gig_groups: dict[tuple[Any, ...], dict[str, Any]] = {}
        gig_document_ids: list[str] = []
        for document in state.documents:
            if document.document_type != "gig_statement":
                continue
            person = _value(document, "person_name")
            month = _value(document, "statement_month")
            receipts = _value(document, "gross_receipts")
            if person is None or month is None or receipts is None:
                continue
            try:
                annual_amount = annualize(float(receipts), "monthly")
            except ValueError:
                reasons.append("MISSING_REQUIRED_FIELD")
                continue
            key = (str(person), str(month))
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
            group["citations"].extend(_citation(document, ("gross_receipts", "statement_month", "platform_fees")))
        if gig_document_ids:
            reasons.append("GIG_INCOME_UNCORROBORATED")
        source_groups.extend(gig_groups.values())

        application_people = {
            str(value)
            for document in app_docs
            if (value := _value(document, "person_name")) is not None
        }
        income_people = {str(group["person"]) for group in source_groups if group.get("person") is not None}
        if application_people and any(person not in application_people for person in income_people):
            reasons.append("HOUSEHOLD_IDENTITY_CONFLICT")

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
            reasons.append("NO_CONFIRMED_INCOME")

        threshold = THRESHOLDS.get(household_size) if isinstance(household_size, int) else None
        if threshold is None:
            reasons.append("NO_FROZEN_THRESHOLD")
            comparison = "no_frozen_threshold"
            arithmetic_difference = None
        else:
            comparison = compare_to_threshold(annualized_income, threshold)
            arithmetic_difference = round(float(threshold) - annualized_income, 2)

        reasons = _dedupe(reasons)
        readiness_status = "READY_TO_REVIEW" if not reasons else "NEEDS_REVIEW"
        rule_ids = ["HUD-MTSP-002", "CH-INCOME-001", "CH-READINESS-001", "CH-DECISION-001"]
        return Analysis(
            household_size=household_size,
            annualized_income=annualized_income,
            threshold=threshold,
            comparison=comparison,
            arithmetic_difference=arithmetic_difference,
            readiness_status=readiness_status,
            review_reasons=reasons,
            income_sources=source_models,
            rule_citations=self.rules.citations(rule_ids),
            decision_boundary="No eligibility determination is included.",
        )
