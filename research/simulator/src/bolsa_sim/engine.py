"""Python port of packages/pricing-engine/src/engine.ts (spec 5.3).

This is the research implementation. It exists so the simulator can explore
parameter space without a Node process in the loop, and it is checked against
the production engine on every shared test vector (spec 5.6) by
tests/test_parity.py. The operations are kept in the same order as the
TypeScript version so that both produce bit-identical floats.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Mapping, Sequence

from .money import clip, round_into_range
from .params import DEMAND_EPSILON, RENORMALIZE_EPSILON, RENORMALIZE_MAX_ITERATIONS
from .params import RENORMALIZE_TOLERANCE, EngineParams


@dataclass(frozen=True)
class ManualOverride:
    price: int
    until_tick: int


@dataclass(frozen=True)
class ProductState:
    product_id: str
    group_id: str
    base_price: int
    min_price: int
    max_price: int
    current_price: int
    smoothed_demand: float = 0.0
    raw_price: float | None = None
    expected_share: float | None = None
    stock_initial: int = 0
    stock_available: int = 0
    active: bool = True
    manual_override: ManualOverride | None = None


@dataclass(frozen=True)
class ExplainEntry:
    x: float = 0.0
    r: float = 0.0
    k: float = 0.0
    delta: float = 0.0
    c: float = 1.0


@dataclass
class TickOutput:
    tick: int
    products: list[ProductState]
    explain: dict[str, ExplainEntry] = field(default_factory=dict)


@dataclass
class _Working:
    product: ProductState
    demand: float
    previous: float
    candidate: float
    x: float = 0.0
    r: float = 0.0
    k: float = 0.0
    delta: float = 0.0
    c: float = 1.0
    pinned: bool = False

    def explain(self) -> ExplainEntry:
        return ExplainEntry(x=self.x, r=self.r, k=self.k, delta=self.delta, c=self.c)


def _override_applies_at(product: ProductState, tick: int) -> bool:
    return product.manual_override is not None and tick <= product.manual_override.until_tick


def _previous_raw_price(product: ProductState) -> float:
    raw = product.raw_price if product.raw_price is not None else product.current_price
    return clip(raw, product.min_price, product.max_price)


def _expected_shares(active: Sequence[ProductState]) -> dict[str, float]:
    even = 1 / len(active)
    raw = [
        p.expected_share if p.expected_share is not None and p.expected_share > 0 else even
        for p in active
    ]
    total = sum(raw)
    return {
        p.product_id: (value / total if total > 0 else 0.0)
        for p, value in zip(active, raw, strict=True)
    }


def _renormalize(free: list[_Working]) -> None:
    for _ in range(RENORMALIZE_MAX_ITERATIONS):
        numerator = 0.0
        denominator = 0.0
        for entry in free:
            weight = entry.demand + RENORMALIZE_EPSILON
            numerator += weight * entry.product.base_price
            denominator += weight * entry.candidate

        if denominator <= 0:
            return

        c = numerator / denominator
        for entry in free:
            entry.candidate = clip(
                c * entry.candidate, entry.product.min_price, entry.product.max_price
            )
            entry.c *= c

        if abs(c - 1) < RENORMALIZE_TOLERANCE:
            return


def _run_group(
    group: Sequence[ProductState],
    tick: int,
    params: EngineParams,
    paid_units: Mapping[str, int],
    explain: dict[str, ExplainEntry],
) -> list[ProductState]:
    result: list[ProductState] = []

    for product in group:
        if not product.active:
            explain[product.product_id] = ExplainEntry()
            result.append(product)

    active = [product for product in group if product.active]
    if not active:
        return result

    working: list[_Working] = []
    for product in active:
        units = paid_units.get(product.product_id, 0)
        demand = params.ewma_lambda * units + (1 - params.ewma_lambda) * product.smoothed_demand
        previous = _previous_raw_price(product)
        working.append(
            _Working(
                product=product,
                demand=demand,
                previous=previous,
                candidate=previous,
                pinned=_override_applies_at(product, tick),
            )
        )

    expected_shares = _expected_shares(active)
    total_demand = sum(entry.demand for entry in working)
    group_is_idle = total_demand < DEMAND_EPSILON

    for entry in working:
        product = entry.product
        expected = expected_shares.get(product.product_id, 0.0)
        observed = expected if group_is_idle else entry.demand / total_demand

        entry.x = clip((observed - expected) / expected, -1, 1) if expected > 0 else 0.0
        entry.r = (entry.previous - product.base_price) / product.base_price
        stock_ratio = (
            product.stock_available / product.stock_initial if product.stock_initial > 0 else 0.0
        )
        entry.k = (
            max(0.0, params.low_stock_threshold - stock_ratio) / params.low_stock_threshold
            if params.low_stock_threshold > 0
            else 0.0
        )

        if entry.pinned:
            assert product.manual_override is not None
            entry.delta = 0.0
            entry.candidate = product.manual_override.price
            continue

        entry.delta = clip(
            params.demand_sensitivity * entry.x
            - params.mean_reversion * entry.r
            + params.stock_pressure * entry.k,
            -params.max_step_pct,
            params.max_step_pct,
        )
        entry.candidate = entry.previous * (1 + entry.delta)

    free = [entry for entry in working if not entry.pinned]
    if params.renormalize and free:
        _renormalize(free)

    for entry in working:
        product = entry.product
        capped = (
            entry.candidate
            if entry.pinned
            else clip(
                entry.candidate,
                entry.previous * (1 - params.max_step_pct),
                entry.previous * (1 + params.max_step_pct),
            )
        )
        raw = clip(capped, product.min_price, product.max_price)
        price = round_into_range(raw, product.min_price, product.max_price, params.rounding_cents)

        explain[product.product_id] = entry.explain()
        next_override = (
            product.manual_override if _override_applies_at(product, tick) else None
        )
        result.append(
            replace(
                product,
                current_price=price,
                raw_price=raw,
                smoothed_demand=entry.demand,
                manual_override=next_override,
            )
        )

    return result


def run_tick(
    tick: int,
    params: EngineParams,
    products: Sequence[ProductState],
    paid_units: Mapping[str, int] | None = None,
) -> TickOutput:
    paid_units = paid_units or {}
    explain: dict[str, ExplainEntry] = {}

    groups: dict[str, list[ProductState]] = {}
    for product in products:
        groups.setdefault(product.group_id, []).append(product)

    updated: dict[str, ProductState] = {}
    for group in groups.values():
        for product in _run_group(group, tick, params, paid_units, explain):
            updated[product.product_id] = product

    return TickOutput(
        tick=tick,
        products=[updated.get(p.product_id, p) for p in products],
        explain=explain,
    )
