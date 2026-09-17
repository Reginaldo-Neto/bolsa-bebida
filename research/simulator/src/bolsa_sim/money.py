"""Money helpers, ported from packages/shared/src/money.ts.

Parity with the TypeScript engine depends on rounding exactly like JavaScript
does: ``Math.round`` rounds halves towards positive infinity, while Python's
built-in ``round`` uses banker's rounding. Never use ``round`` here.
"""

from __future__ import annotations

import math


def js_round(value: float) -> float:
    """``Math.round`` semantics: halves go up, towards positive infinity."""
    return math.floor(value + 0.5)


def round_to_step(value: float, step: int) -> int:
    if step <= 0:
        raise ValueError(f"step must be a positive integer, got {step}")
    if not math.isfinite(value):
        raise ValueError(f"value must be finite, got {value}")
    sign = -1 if value < 0 else 1
    return int(sign * js_round(abs(value) / step) * step)


def clip(value: float, low: float, high: float) -> float:
    return min(max(value, low), high)


def _nearest_bound(value: float, minimum: int, maximum: int) -> int:
    """Ties go to ``minimum``: when in doubt the participant pays the lower price."""
    return minimum if value - minimum <= maximum - value else maximum


def round_into_range(value: float, minimum: int, maximum: int, step: int) -> int:
    if minimum > maximum:
        raise ValueError(f"min ({minimum}) must not exceed max ({maximum})")

    clamped = clip(value, minimum, maximum)
    rounded = round_to_step(clamped, step)

    if rounded > maximum:
        down = math.floor(maximum / step) * step
        return int(down) if down >= minimum else _nearest_bound(clamped, minimum, maximum)
    if rounded < minimum:
        up = math.ceil(minimum / step) * step
        return int(up) if up <= maximum else _nearest_bound(clamped, minimum, maximum)
    return rounded


def format_cents(value: int) -> str:
    """pt-PT formatting, for console output only."""
    return f"{value / 100:.2f}".replace(".", ",") + " EUR"
