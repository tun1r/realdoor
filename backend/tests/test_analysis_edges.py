from realdoor.models import ConfirmRequest


def _confirmed_demo(service, household_id="HH-001"):
    state = service.create_demo_session(household_id)
    return service.confirm(state.id, ConfirmRequest())


def test_employment_letter_without_pay_stub_needs_review(service):
    state = _confirmed_demo(service)
    state.documents = [
        document
        for document in state.documents
        if document.document_type in {"application_summary", "employment_letter"}
    ]

    service._reanalyze(state)

    assert state.analysis is not None
    assert state.analysis.readiness_status == "NEEDS_REVIEW"
    assert "MISSING_PAY_STUB" in state.analysis.review_reasons
    assert "EMPLOYMENT_INCOME_UNCORROBORATED" in state.analysis.review_reasons


def test_future_pay_stub_and_mixed_person_need_review(service):
    state = _confirmed_demo(service)
    pay_stub = next(document for document in state.documents if document.document_type == "pay_stub")
    next(field for field in pay_stub.fields if field.name == "pay_date").confirmed_value = "2026-07-19"
    next(field for field in pay_stub.fields if field.name == "person_name").confirmed_value = "Different Renter"

    service._reanalyze(state)

    assert state.analysis is not None
    assert "PAY_STUB_EXPIRED" in state.analysis.review_reasons
    assert "HOUSEHOLD_IDENTITY_CONFLICT" in state.analysis.review_reasons
