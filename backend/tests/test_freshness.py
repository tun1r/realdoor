from datetime import date, timedelta

from realdoor.freshness import EVENT_DATE, age_days, is_current


def test_freshness_boundaries_are_inclusive_at_day_60():
    for days, expected in ((59, True), (60, True), (61, False)):
        document_date = EVENT_DATE - timedelta(days=days)
        assert age_days(document_date) == days
        assert is_current(document_date) is expected


def test_future_dated_evidence_is_not_current():
    assert not is_current(EVENT_DATE + timedelta(days=1))
