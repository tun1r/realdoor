import pytest


EXPECTED = {
    "HH-001": (56316.0, "READY_TO_REVIEW", []),
    "HH-002": (49920.0, "NEEDS_REVIEW", ["PAY_STUB_TOTAL_CONFLICT"]),
    "HH-003": (40230.0, "READY_TO_REVIEW", []),
    "HH-004": (51008.0, "NEEDS_REVIEW", ["GIG_INCOME_UNCORROBORATED"]),
    "HH-005": (45968.0, "NEEDS_REVIEW", ["EMPLOYMENT_LETTER_EXPIRED"]),
    "HH-006": (105000.0, "READY_TO_REVIEW", []),
}


@pytest.mark.parametrize("household_id", sorted(EXPECTED))
def test_visible_fixture_analysis_matches_frozen_gold(service, household_id):
    state = service.create_demo_session(household_id)
    assert state.analysis is None
    state = service.confirm(state.id, __import__("realdoor.models", fromlist=["ConfirmRequest"]).ConfirmRequest())
    analysis = state.analysis
    assert analysis is not None
    expected_income, expected_status, expected_reasons = EXPECTED[household_id]
    assert analysis.annualized_income == expected_income
    assert analysis.threshold is not None
    assert analysis.comparison == "below_or_equal"
    assert analysis.readiness_status == expected_status
    assert analysis.review_reasons == expected_reasons


def test_duplicate_pay_stubs_and_employment_letter_are_not_additive(service):
    state = service.create_demo_session("HH-001")
    state = service.confirm(state.id, __import__("realdoor.models", fromlist=["ConfirmRequest"]).ConfirmRequest())
    assert state.analysis is not None
    wage_sources = [source for source in state.analysis.income_sources if source.source_type == "wage"]
    assert len(wage_sources) == 1
    assert wage_sources[0].annualized_amount == 56316.0
    assert wage_sources[0].corroborating_document_ids == ["HH-001-D04"]
