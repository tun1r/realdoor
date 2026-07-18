"""The frozen challenge freshness convention."""

from __future__ import annotations

from datetime import date


EVENT_DATE = date(2026, 7, 18)
FRESHNESS_DAYS = 60


def age_days(document_date: date, event_date: date = EVENT_DATE) -> int:
    return (event_date - document_date).days


def is_current(document_date: date, event_date: date = EVENT_DATE) -> bool:
    age = age_days(document_date, event_date)
    return 0 <= age <= FRESHNESS_DAYS
