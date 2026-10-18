import calc


def test_add():
    assert calc.add(2, 3) == 5


def test_mean(numbers):
    assert calc.mean(numbers) == 2.5


def test_add_zero():
    assert calc.add(0, 0) == 0
