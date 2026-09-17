"""Rounding parity with packages/shared/src/money.ts.

The cases here mirror money.test.ts one for one. Python's built-in ``round``
would fail several of them, which is exactly why the port uses ``js_round``.
"""

from __future__ import annotations

import pytest

from bolsa_sim.money import js_round, round_into_range, round_to_step


def test_js_round_sends_halves_up_not_to_even() -> None:
    assert js_round(0.5) == 1
    assert js_round(1.5) == 2
    assert js_round(2.5) == 3
    # Python's built-in round would give 2 here.
    assert round(2.5) == 2


@pytest.mark.parametrize(
    ("value", "step", "expected"),
    [(144, 10, 140), (145, 10, 150), (149, 10, 150), (150, 10, 150), (147, 1, 147)],
)
def test_round_to_step(value: float, step: int, expected: int) -> None:
    assert round_to_step(value, step) == expected


def test_round_to_step_rejects_invalid_steps() -> None:
    with pytest.raises(ValueError):
        round_to_step(147, 0)
    with pytest.raises(ValueError):
        round_to_step(float("nan"), 10)


@pytest.mark.parametrize(
    ("value", "low", "high", "step", "expected"),
    [
        (147, 100, 200, 10, 150),
        (199, 100, 195, 10, 190),
        (101, 105, 200, 10, 110),
        (104, 101, 109, 10, 101),
        (107, 101, 109, 10, 109),
        (102, 101, 104, 10, 101),
        (500, 133, 133, 10, 133),
    ],
)
def test_round_into_range(value: float, low: int, high: int, step: int, expected: int) -> None:
    assert round_into_range(value, low, high, step) == expected


def test_round_into_range_rejects_an_inverted_range() -> None:
    with pytest.raises(ValueError):
        round_into_range(150, 200, 100, 10)
