from __future__ import annotations

import io
import json
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from realdoor import api
from realdoor.coordinates import BBOX_UNITS
from realdoor.extraction import extract_document
from realdoor.models import ConfirmRequest
from realdoor.service import RealDoorService, ServiceError
from scripts.generate_hh005_fresh_employment_letter import (
    build_adversarial_employment_pdf,
    build_application_pdf,
    build_pay_stub_pdf,
    build_pdf,
)


FIXTURE = Path(__file__).parent / "fixtures" / "hh-005_fresh_employment_letter.pdf"


def test_hh005_replacement_fixture_is_byte_stable():
    assert build_pdf() == build_pdf() == FIXTURE.read_bytes()


def _confirmed_hh005(service):
    state = service.create_session()
    service._add_document(
        state.id,
        "hh-005_d01_application_summary.pdf",
        build_application_pdf(),
        expected_type="application_summary",
        document_id="HH-005-D01",
    )
    service._add_document(
        state.id,
        "hh-005_d02_pay_stub.pdf",
        build_pay_stub_pdf(),
        expected_type="pay_stub",
        document_id="HH-005-D02",
    )
    service._add_document(
        state.id,
        "hh-005_d03_pay_stub.pdf",
        build_pay_stub_pdf(
            pay_date="2026-06-20",
            period_start="2026-06-03",
            period_end="2026-06-16",
        ),
        expected_type="pay_stub",
        document_id="HH-005-D03",
    )
    service._add_document(
        state.id,
        "hh-005_d04_employment_letter.pdf",
        build_pdf(document_date="2026-04-14"),
        expected_type="employment_letter",
        document_id="HH-005-D04",
    )
    return service.confirm(state.id, ConfirmRequest())


def _document(state, document_id):
    return next(document for document in state.documents if document.id == document_id)


def _field(document, name):
    return next(field for field in document.fields if field.name == name)


def _session_snapshot(session_dir):
    return {
        str(path.relative_to(session_dir)): path.read_bytes()
        for path in session_dir.rglob("*")
        if path.is_file()
    }


def test_confirm_all_preserves_corrected_effective_values(local_service):
    service = local_service
    state = _confirmed_hh005(service)
    pay_stub = next(document for document in state.documents if document.document_type == "pay_stub")
    rate = _field(pay_stub, "hourly_rate")

    state = service.correct_field(state.id, rate.id, 25.5)
    state = service.confirm(state.id, ConfirmRequest())

    corrected = _field(_document(state, pay_stub.id), "hourly_rate")
    assert corrected.extracted_value == 26.0
    assert corrected.confirmed_value == 25.5
    assert corrected.confirmed is True
    assert len(corrected.correction_history) == 1


@pytest.mark.parametrize("version_mode", ["missing", "explicit"])
def test_v1_state_migrates_reanalyzes_persists_and_is_idempotent(local_service, version_mode):
    service = local_service
    state = _confirmed_hh005(service)
    state_path = service.settings.session_dir / state.id / "session.json"
    raw = json.loads(state_path.read_text(encoding="utf-8"))
    if version_mode == "missing":
        raw.pop("schema_version")
    else:
        raw["schema_version"] = 1
    raw.pop("replacement_events")
    for document in raw["documents"]:
        document["fields"] = [field for field in document["fields"] if field["name"] != "source_name"]
        document.pop("status")
        document.pop("replaces_document_id")
        document.pop("superseded_by_document_id")
        document.pop("superseded_at")
    raw["packet"].pop("packet_complete")
    raw["packet"].pop("excluded_active_document_ids")
    raw["analysis"].pop("review_issues")
    state_path.write_text(json.dumps(raw), encoding="utf-8")

    migrated = service.get_session(state.id)
    first_persisted = state_path.read_text(encoding="utf-8")
    loaded_again = service.get_session(state.id)

    assert migrated.schema_version == 2
    assert all(document.status == "active" for document in migrated.documents)
    assert migrated.analysis is not None
    assert migrated.analysis.annualized_income == state.analysis.annualized_income
    assert migrated.analysis.readiness_status == state.analysis.readiness_status
    assert migrated.analysis.review_reasons == ["EMPLOYMENT_LETTER_EXPIRED"]
    assert migrated.packet.packet_complete is True
    assert migrated.replacement_events == []
    recovered = [
        field
        for document in migrated.documents
        for field in document.fields
        if field.name == "source_name"
    ]
    assert recovered
    assert all(field.document_id == field.id.split(":", 1)[0] for field in recovered)
    assert all(field.confirmed and field.confirmed_value for field in recovered)
    assert _field(_document(migrated, "HH-005-D04"), "source_name").confirmed_value == "North Loop Books"
    assert loaded_again == migrated
    assert state_path.read_text(encoding="utf-8") == first_persisted


def test_unsupported_schema_version_is_rejected(local_service):
    service = local_service
    state = service.create_session()
    state_path = service.settings.session_dir / state.id / "session.json"
    raw = json.loads(state_path.read_text(encoding="utf-8"))
    raw["schema_version"] = 99
    state_path.write_text(json.dumps(raw), encoding="utf-8")

    with pytest.raises(ServiceError, match="Session not found"):
        service.get_session(state.id)


def test_expired_letter_issue_is_stable_linked_and_drives_legacy_reasons(local_service):
    service = local_service
    state = _confirmed_hh005(service)
    stale = _document(state, "HH-005-D04")
    issue = state.analysis.review_issues[0]

    assert issue.code == "EMPLOYMENT_LETTER_EXPIRED"
    assert len(state.analysis.review_issues) == 1
    assert issue.message == (
        "Under the challenge\u2019s frozen 60-day document-freshness convention, "
        "this employment letter needs replacement."
    )
    assert issue.affected_document_ids == [stale.id]
    assert issue.affected_field_ids == [_field(stale, "document_date").id]
    assert issue.rule_ids == ["CH-READINESS-001"]
    assert issue.action.model_dump() == {
        "type": "replace_document",
        "document_id": stale.id,
        "label": "Replace document",
    }
    assert state.analysis.review_reasons == [issue.code]
    service._reanalyze(state)
    assert state.analysis.review_issues[0].issue_id == issue.issue_id


def test_project_owned_hh005_fixture_is_complete_local_text_extraction(local_settings):
    result = extract_document(FIXTURE.read_bytes(), FIXTURE.name, local_settings, allow_vision=False)
    values = {field.name: field.extracted_value for field in result.document.fields}

    assert result.document.document_type == "employment_letter"
    assert result.document.page_count == 1
    assert values == {
        "person_name": "Tess Alder",
        "document_date": "2026-07-12",
        "weekly_hours": 34.0,
        "hourly_rate": 26.0,
        "source_name": "North Loop Books",
    }
    assert all(field.method == "text_layer" for field in result.document.fields)
    assert all(field.page == 1 and field.bbox and field.bbox_units == BBOX_UNITS for field in result.document.fields)


@pytest.mark.parametrize(
    ("data_factory", "message"),
    [
        (lambda settings: build_pay_stub_pdf(), "wrong document type"),
        (lambda settings: build_pdf(person_name="Another Person"), "wrong person or household"),
        (lambda settings: build_pdf(source_name="Different Books"), "wrong employer or income source"),
        (lambda settings: b"not a pdf", "Replacement extraction failed"),
    ],
)
def test_rejected_replacement_leaves_state_and_assets_untouched(local_service, data_factory, message):
    service = local_service
    state = _confirmed_hh005(service)
    session_dir = service.settings.session_dir / state.id
    before = _session_snapshot(session_dir)

    with pytest.raises(ServiceError, match=message) as error:
        service.stage_replacement(
            state.id,
            "HH-005-D04",
            "candidate.pdf",
            data_factory(service.settings),
        )

    assert error.value.status_code == 422
    assert _session_snapshot(session_dir) == before
    unchanged = service.get_session(state.id)
    assert len(unchanged.documents) == 4
    assert _document(unchanged, "HH-005-D04").status == "active"


def test_pending_is_isolated_and_atomic_promotion_resolves_hh005(local_service):
    service = local_service
    state = _confirmed_hh005(service)
    stale = _document(state, "HH-005-D04")
    stale_issue_id = state.analysis.review_issues[0].issue_id
    canonical_analysis = state.analysis.model_dump(mode="json")

    state = service.stage_replacement(state.id, stale.id, FIXTURE.name, FIXTURE.read_bytes())
    pending = next(document for document in state.documents if document.status == "pending_replacement")

    assert stale.status == "active"
    assert pending.replaces_document_id == stale.id
    assert pending.id not in state.packet.included_document_ids
    assert state.packet.packet_complete is True
    assert state.analysis.model_dump(mode="json") == canonical_analysis
    assert all(not field.confirmed for field in pending.fields)

    bulk = service.confirm(state.id, ConfirmRequest())
    assert all(not field.confirmed for field in _document(bulk, pending.id).fields)
    with pytest.raises(ServiceError, match="Only active"):
        service.confirm(state.id, ConfirmRequest(field_ids=[pending.fields[0].id]))

    state = service.correct_field(state.id, _field(pending, "hourly_rate").id, 26.0)
    corrected_pending = _document(state, pending.id)
    assert len(_field(corrected_pending, "hourly_rate").correction_history) == 1
    assert _document(state, stale.id).status == "active"

    promoted = service.confirm_replacement(state.id, pending.id)
    old = _document(promoted, stale.id)
    new = _document(promoted, pending.id)

    assert old.status == "superseded"
    assert old.superseded_by_document_id == new.id
    assert old.superseded_at == promoted.replacement_events[0].timestamp
    assert new.status == "active"
    assert new.replaces_document_id == old.id
    assert all(field.confirmed for field in new.fields)
    assert _field(new, "hourly_rate").confirmed_value == 26.0
    assert len(_field(new, "hourly_rate").correction_history) == 1
    assert len(promoted.replacement_events) == 1
    assert promoted.replacement_events[0].old_document_id == old.id
    assert promoted.replacement_events[0].new_document_id == new.id
    assert promoted.replacement_events[0].resolved_issue_ids == [stale_issue_id]
    assert promoted.replacement_events[0].resolved_issues == [state.analysis.review_issues[0]]
    assert old.id not in promoted.packet.included_document_ids
    assert new.id in promoted.packet.included_document_ids
    assert promoted.packet.packet_complete is True
    assert promoted.analysis.annualized_income == 45968.0
    assert promoted.analysis.threshold == 111120.0
    assert promoted.analysis.readiness_status == "READY_TO_REVIEW"
    assert promoted.analysis.review_issues == []
    assert promoted.analysis.review_reasons == []
    assert promoted.analysis.decision_boundary == "Ready for human review. No program determination was made."
    assert service.repository.source_path(state.id, old.id).is_file()
    assert service.repository.source_path(state.id, new.id).is_file()

    audit_path = service.settings.session_dir / state.id / "audit.jsonl"
    events = [json.loads(line) for line in audit_path.read_text(encoding="utf-8").splitlines()]
    replacement_audits = [event for event in events if event["action"] == "replacement_confirmed"]
    assert len(replacement_audits) == 1
    assert replacement_audits[0]["document_ids"] == [old.id, new.id]

    with pytest.raises(ServiceError, match="read-only"):
        service.correct_field(state.id, old.fields[0].id, "Tess Alder")
    with pytest.raises(ServiceError, match="Only active"):
        service.confirm(state.id, ConfirmRequest(field_ids=[old.fields[0].id]))
    with pytest.raises(ServiceError, match="Only active documents"):
        service.update_packet(state.id, [old.id], None)
    with pytest.raises(ServiceError, match="not a pending replacement"):
        service.confirm_replacement(state.id, new.id)
    assert len(service.get_session(state.id).replacement_events) == 1
    with pytest.raises(ServiceError, match="active document"):
        service.stage_replacement(state.id, old.id, FIXTURE.name, FIXTURE.read_bytes())


def test_hh005_omission_does_not_change_canonical_analysis_and_exports_warn(local_service):
    service = local_service
    state = _confirmed_hh005(service)
    stale = _document(state, "HH-005-D04")
    canonical = state.analysis.model_dump(mode="json")
    selected = [document.id for document in state.documents if document.id != stale.id]

    state = service.update_packet(state.id, selected, None)
    assert state.analysis.model_dump(mode="json") == canonical
    assert state.packet.packet_complete is False
    assert state.packet.excluded_active_document_ids == [stale.id]

    with zipfile.ZipFile(io.BytesIO(service.packet_zip(state.id))) as archive:
        names = archive.namelist()
        packet = json.loads(archive.read("packet.json"))
        html = archive.read("packet.html").decode("utf-8")
        assert packet["analysis"] == canonical
        assert packet["warnings"]
        assert stale.id in packet["warnings"][0]
        assert "Incomplete packet" in html
        assert stale.id in html
        assert "submission.json" not in names
        assert stale.file_name not in " ".join(names)


def test_complete_promoted_packet_uses_active_sources_and_emits_submission(local_service):
    service = local_service
    state = _confirmed_hh005(service)
    stale = _document(state, "HH-005-D04")
    state = service.stage_replacement(state.id, stale.id, FIXTURE.name, FIXTURE.read_bytes())
    pending = next(document for document in state.documents if document.status == "pending_replacement")
    state = service.confirm_replacement(state.id, pending.id)

    with zipfile.ZipFile(io.BytesIO(service.packet_zip(state.id))) as archive:
        names = archive.namelist()
        packet = json.loads(archive.read("packet.json"))
        submission = json.loads(archive.read("submission.json"))
        assert packet["packet_complete"] is True
        assert packet["excluded_active_document_ids"] == []
        assert packet["analysis"] == state.analysis.model_dump(mode="json")
        assert all(document["status"] == "active" for document in packet["documents"])
        assert stale.file_name not in " ".join(names)
        assert FIXTURE.name in " ".join(names)
        assert set(submission) == {
            "household_id",
            "annualized_income",
            "comparison",
            "readiness_status",
            "citations",
        }
        assert submission["annualized_income"] == 45968.0
        assert submission["readiness_status"] == "READY_TO_REVIEW"


def test_complete_needs_review_packet_emits_submission_without_changing_analysis(local_service):
    service = local_service
    state = _confirmed_hh005(service)
    canonical = state.analysis.model_dump(mode="json")

    with zipfile.ZipFile(io.BytesIO(service.packet_zip(state.id))) as archive:
        submission = json.loads(archive.read("submission.json"))

    assert submission["annualized_income"] == 45968.0
    assert submission["readiness_status"] == "NEEDS_REVIEW"
    assert service.get_session(state.id).analysis.model_dump(mode="json") == canonical


def test_superseded_values_do_not_feed_active_analysis(local_service):
    service = local_service
    state = _confirmed_hh005(service)
    state = service.stage_replacement(state.id, "HH-005-D04", FIXTURE.name, FIXTURE.read_bytes())
    pending = next(document for document in state.documents if document.status == "pending_replacement")
    state = service.confirm_replacement(state.id, pending.id)
    old = _document(state, "HH-005-D04")
    _field(old, "weekly_hours").confirmed_value = 999.0

    service._reanalyze(state)

    assert state.analysis.annualized_income == 45968.0
    assert state.analysis.review_issues == []


def test_replacement_api_and_full_session_deletion(local_settings, monkeypatch):
    test_service = RealDoorService(local_settings)
    monkeypatch.setattr(api, "service", test_service)
    client = TestClient(api.app)
    state = _confirmed_hh005(test_service)
    session_id = state.id

    staged_response = client.post(
        f"/api/sessions/{session_id}/documents/HH-005-D04/replacement",
        files={"file": (FIXTURE.name, FIXTURE.read_bytes(), "application/pdf")},
    )
    assert staged_response.status_code == 200
    staged = staged_response.json()
    pending = next(document for document in staged["documents"] if document["status"] == "pending_replacement")
    pending_rate = next(field for field in pending["fields"] if field["name"] == "hourly_rate")
    corrected = client.patch(
        f"/api/sessions/{session_id}/fields/{pending_rate['id']}",
        json={"value": 26.0},
    )
    assert corrected.status_code == 200
    promoted_response = client.post(
        f"/api/sessions/{session_id}/documents/{pending['id']}/confirm-replacement"
    )
    assert promoted_response.status_code == 200

    test_service.stage_replacement(session_id, pending["id"], FIXTURE.name, FIXTURE.read_bytes())
    final_state = test_service.get_session(session_id)
    assert {document.status for document in final_state.documents} == {
        "active",
        "pending_replacement",
        "superseded",
    }
    assert final_state.replacement_events
    assert any(field.correction_history for document in final_state.documents for field in document.fields)
    test_service.packet_zip(session_id)
    session_dir = local_settings.session_dir / session_id
    assert session_dir.is_dir()

    receipt = test_service.delete_session(session_id)
    assert receipt["deleted"] is True
    assert not session_dir.exists()


@pytest.mark.parametrize("missing", ["session", "target"])
def test_stage_preflight_rejects_before_extraction(local_service, monkeypatch, missing):
    service = local_service
    state = _confirmed_hh005(service)
    calls = 0

    def fail_if_called(*args, **kwargs):
        nonlocal calls
        calls += 1
        raise AssertionError("extraction must not run")

    monkeypatch.setattr("realdoor.service.extract_document", fail_if_called)
    session_id = str(uuid4()) if missing == "session" else state.id
    document_id = "missing-target" if missing == "target" else "HH-005-D04"

    with pytest.raises(ServiceError) as error:
        service.stage_replacement(session_id, document_id, FIXTURE.name, FIXTURE.read_bytes())

    assert error.value.status_code == 404
    assert calls == 0


def test_duplicate_pending_is_rejected_before_extraction_and_preserves_candidate(local_service, monkeypatch):
    service = local_service
    state = _confirmed_hh005(service)
    state = service.stage_replacement(state.id, "HH-005-D04", FIXTURE.name, FIXTURE.read_bytes())
    pending = next(document for document in state.documents if document.status == "pending_replacement")
    candidate_assets = service.repository.source_path(state.id, pending.id).read_bytes()

    def fail_if_called(*args, **kwargs):
        raise AssertionError("duplicate preflight must not extract")

    monkeypatch.setattr("realdoor.service.extract_document", fail_if_called)
    with pytest.raises(ServiceError, match="already pending") as error:
        service.stage_replacement(state.id, "HH-005-D04", FIXTURE.name, FIXTURE.read_bytes())

    assert error.value.status_code == 409
    persisted = service.get_session(state.id)
    candidates = [document for document in persisted.documents if document.status == "pending_replacement"]
    assert [document.id for document in candidates] == [pending.id]
    assert service.repository.source_path(state.id, pending.id).read_bytes() == candidate_assets


def test_replacement_audit_failures_do_not_undo_committed_state(local_service, monkeypatch):
    service = local_service
    state = _confirmed_hh005(service)

    def fail_audit(*args, **kwargs):
        raise OSError("injected audit failure")

    monkeypatch.setattr(service.repository, "audit", fail_audit)
    staged = service.stage_replacement(state.id, "HH-005-D04", FIXTURE.name, FIXTURE.read_bytes())
    pending = next(document for document in staged.documents if document.status == "pending_replacement")
    assert service.repository.source_path(state.id, pending.id).is_file()

    promoted = service.confirm_replacement(state.id, pending.id)
    assert _document(promoted, "HH-005-D04").status == "superseded"
    assert _document(promoted, pending.id).status == "active"
    assert service.repository.source_path(state.id, pending.id).is_file()
    assert len(promoted.replacement_events) == 1


def test_stage_state_save_failure_restores_original_state_and_assets(local_service, monkeypatch):
    service = local_service
    state = _confirmed_hh005(service)
    session_dir = service.settings.session_dir / state.id
    before = _session_snapshot(session_dir)

    def fail_save(*args, **kwargs):
        raise OSError("injected save failure")

    monkeypatch.setattr(service.repository, "save", fail_save)
    with pytest.raises(ServiceError, match="could not be staged"):
        service.stage_replacement(state.id, "HH-005-D04", FIXTURE.name, FIXTURE.read_bytes())

    assert _session_snapshot(session_dir) == before


def test_document_audit_failure_is_non_corrupting(local_service, monkeypatch):
    service = local_service
    state = service.create_session()

    def fail_audit(*args, **kwargs):
        raise OSError("injected audit failure")

    monkeypatch.setattr(service.repository, "audit", fail_audit)
    document = service._add_document(
        state.id,
        "application.pdf",
        build_application_pdf(),
        expected_type="application_summary",
        document_id="HH-005-D01",
    )

    persisted = service.get_session(state.id)
    assert [item.id for item in persisted.documents] == [document.id]
    assert service.repository.source_path(state.id, document.id).is_file()


def test_single_pay_stub_replacement_needs_no_independent_corroboration(local_service):
    service = local_service
    state = service.create_session()
    service._add_document(
        state.id,
        "application.pdf",
        build_application_pdf(),
        expected_type="application_summary",
        document_id="HH-005-D01",
    )
    service._add_document(
        state.id,
        "pay-stub.pdf",
        build_pay_stub_pdf(),
        expected_type="pay_stub",
        document_id="HH-005-D02",
    )
    service.confirm(state.id, ConfirmRequest())

    staged = service.stage_replacement(
        state.id,
        "HH-005-D02",
        "fresh-pay-stub.pdf",
        build_pay_stub_pdf(pay_date="2026-07-11", period_start="2026-06-24", period_end="2026-07-07"),
    )

    assert len([document for document in staged.documents if document.status == "pending_replacement"]) == 1


def test_text_layer_rendered_mismatch_is_rejected_without_state_or_assets(local_service):
    service = local_service
    state = _confirmed_hh005(service)
    session_dir = service.settings.session_dir / state.id
    before = _session_snapshot(session_dir)

    with pytest.raises(ServiceError, match="Rendered page does not verify"):
        service.stage_replacement(
            state.id,
            "HH-005-D04",
            "adversarial.pdf",
            build_adversarial_employment_pdf(),
        )

    assert _session_snapshot(session_dir) == before


def test_stage_forces_local_extraction_when_hosted_vision_is_enabled(local_settings, monkeypatch):
    settings = replace(local_settings, hosted_vision_enabled=True, openai_api_key="test-key")
    service = RealDoorService(settings)
    state = _confirmed_hh005(service)
    real_extract = extract_document
    allow_vision_values = []

    def recording_extract(*args, **kwargs):
        allow_vision_values.append(kwargs.get("allow_vision"))
        return real_extract(*args, **kwargs)

    monkeypatch.setattr("realdoor.service.extract_document", recording_extract)
    service.stage_replacement(state.id, "HH-005-D04", FIXTURE.name, FIXTURE.read_bytes())

    assert allow_vision_values == [False]


@pytest.mark.parametrize(
    ("field_name", "value", "message"),
    [
        ("person_name", "Different Person", "wrong person or household"),
        ("source_name", "Different Books", "wrong employer or income source"),
        ("document_date", None, "unresolved field"),
    ],
)
def test_promotion_revalidates_pending_without_changing_canonical_state(
    local_service,
    field_name,
    value,
    message,
):
    service = local_service
    state = _confirmed_hh005(service)
    old = _document(state, "HH-005-D04")
    canonical_analysis = state.analysis.model_dump(mode="json")
    canonical_packet = state.packet.model_dump(mode="json")
    staged = service.stage_replacement(state.id, old.id, FIXTURE.name, FIXTURE.read_bytes())
    pending = next(document for document in staged.documents if document.status == "pending_replacement")
    field = _field(pending, field_name)
    if value is None:
        persisted = service.get_session(state.id)
        persisted_field = _field(_document(persisted, pending.id), field_name)
        persisted_field.extracted_value = None
        persisted_field.confirmed_value = None
        persisted_field.confirmed = False
        service.repository.save(persisted)
    else:
        service.correct_field(state.id, field.id, value)

    with pytest.raises(ServiceError, match=message) as error:
        service.confirm_replacement(state.id, pending.id)

    assert error.value.status_code == 422
    unchanged = service.get_session(state.id)
    assert _document(unchanged, old.id).status == "active"
    assert _document(unchanged, pending.id).status == "pending_replacement"
    assert unchanged.analysis.model_dump(mode="json") == canonical_analysis
    assert unchanged.packet.model_dump(mode="json") == canonical_packet
    assert unchanged.replacement_events == []


def test_concurrent_corrections_do_not_stale_write(local_service):
    service = local_service
    state = _confirmed_hh005(service)
    pay_stub = _document(state, "HH-005-D02")
    barrier = threading.Barrier(2)

    def correct(field_id, value):
        barrier.wait()
        service.correct_field(state.id, field_id, value)

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(correct, _field(pay_stub, "gross_pay").id, 1768.0)
        second = executor.submit(correct, _field(pay_stub, "net_pay").id, 1380.0)
        first.result()
        second.result()

    persisted = service.get_session(state.id)
    persisted_stub = _document(persisted, pay_stub.id)
    assert _field(persisted_stub, "gross_pay").confirmed_value == 1768.0
    assert _field(persisted_stub, "net_pay").confirmed_value == 1380.0
    assert len(_field(persisted_stub, "gross_pay").correction_history) == 1
    assert len(_field(persisted_stub, "net_pay").correction_history) == 1
