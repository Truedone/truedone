import pytest

from checkout import checkout, receipt


def test_empty_basket_is_refused():
    with pytest.raises(ValueError):
        checkout([])


def test_total_is_the_sum_of_the_items():
    assert checkout([2, 3]) == 5


def test_receipt_prints_a_header():
    assert receipt([1]).startswith("Receipt")
