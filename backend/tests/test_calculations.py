import pytest

from realdoor.calculations import annualize, compare_to_threshold


@pytest.mark.parametrize(
    ("frequency", "expected"),
    [("weekly", 5200.0), ("biweekly", 2600.0), ("semimonthly", 2400.0), ("monthly", 1200.0), ("annual", 100.0)],
)
def test_annualize_matches_supplied_convention(frequency, expected):
    assert annualize(100, frequency) == expected


def test_annualize_rejects_bad_frequency_and_negative_amount():
    with pytest.raises(ValueError, match="Unsupported frequency"):
        annualize(100, "daily")
    with pytest.raises(ValueError, match="non-negative"):
        annualize(-1, "weekly")


def test_threshold_comparison_includes_equality():
    assert compare_to_threshold(100, 100) == "below_or_equal"
    assert compare_to_threshold(100.01, 100) == "above"
    with pytest.raises(ValueError, match="non-negative"):
        compare_to_threshold(-1, 100)
