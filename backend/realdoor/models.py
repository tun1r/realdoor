"""Pydantic response and persistence models for the fixed API contract."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class CorrectionRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timestamp: str
    previous_value: Any = None
    new_value: Any = None
    confirmed: bool


class FieldRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    label: str
    value_type: str
    extracted_value: Any = None
    confirmed_value: Any = None
    confirmed: bool = False
    confidence: float = Field(ge=0, le=1)
    method: str
    document_id: str
    page: int | None = Field(default=None, ge=1)
    bbox: list[float] | None = None
    bbox_units: str | None = None
    correction_history: list[CorrectionRecord] = Field(default_factory=list)

    @field_validator("bbox")
    @classmethod
    def validate_bbox_shape(cls, value: list[float] | None) -> list[float] | None:
        if value is not None and len(value) != 4:
            raise ValueError("bbox must contain four coordinates")
        return value


class DocumentRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    file_name: str
    document_type: str
    page_count: int = Field(ge=1)
    rasterized: bool
    contains_untrusted_instruction: bool
    fields: list[FieldRecord] = Field(default_factory=list)
    status: Literal["active", "pending_replacement", "superseded"] = "active"
    replaces_document_id: str | None = None
    superseded_by_document_id: str | None = None
    superseded_at: str | None = None


class ReviewAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["add_document", "correct_field", "review_document", "replace_document"]
    document_id: str | None = None
    label: str


class ReviewIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issue_id: str
    code: str
    message: str
    affected_document_ids: list[str] = Field(default_factory=list)
    affected_field_ids: list[str] = Field(default_factory=list)
    rule_ids: list[str] = Field(default_factory=list)
    action: ReviewAction


class IncomeSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    source_type: str
    document_ids: list[str]
    corroborating_document_ids: list[str] = Field(default_factory=list)
    amount: float
    frequency: str
    annualized_amount: float
    basis: str
    corroborated: bool
    citations: list[dict[str, Any]] = Field(default_factory=list)


class Analysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    household_size: int | None = None
    annualized_income: float | None = None
    threshold: float | None = None
    comparison: str
    arithmetic_difference: float | None = None
    readiness_status: str
    review_issues: list[ReviewIssue] = Field(default_factory=list)
    review_reasons: list[str] = Field(default_factory=list)
    income_sources: list[IncomeSource] = Field(default_factory=list)
    rule_citations: list[dict[str, Any]] = Field(default_factory=list)
    decision_boundary: str

    @model_validator(mode="after")
    def derive_review_reasons(self) -> "Analysis":
        self.review_reasons = list(dict.fromkeys(issue.code for issue in self.review_issues))
        return self


class PacketState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    included_document_ids: list[str] = Field(default_factory=list)
    renter_note: str | None = None
    packet_complete: bool = True
    excluded_active_document_ids: list[str] = Field(default_factory=list)


class ReplacementEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    old_document_id: str
    new_document_id: str
    timestamp: str
    resolved_issue_ids: list[str] = Field(default_factory=list)
    resolved_issues: list[ReviewIssue] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: str


class SessionState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[2] = 2
    id: str
    created_at: str
    updated_at: str
    status: str
    documents: list[DocumentRecord] = Field(default_factory=list)
    analysis: Analysis | None = None
    packet: PacketState = Field(default_factory=PacketState)
    all_fields_confirmed: bool = False
    replacement_events: list[ReplacementEvent] = Field(default_factory=list)


class ConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_ids: list[str] | None = None


class CorrectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: Any
    confirmed: bool = True


class QuestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=4000)


class PacketRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    included_document_ids: list[str]
    renter_note: str | None = Field(default=None, max_length=4000)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
