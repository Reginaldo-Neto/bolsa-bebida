"""Spec F1 acceptance: TypeScript and Python must agree on every shared vector.

Prices are integers, so they are compared exactly. The smoothed demand is a
float and is compared with a tight tolerance; both implementations perform the
same operations in the same order, so in practice the values are identical.
"""

from __future__ import annotations

import pytest

from bolsa_sim.vectors import VECTORS_DIR, PricingVector, load_all_vectors, replay

VECTORS = list(load_all_vectors())


def test_vectors_are_present() -> None:
    assert VECTORS_DIR.is_dir(), f"missing shared vectors at {VECTORS_DIR}"
    names = {vector.name for vector in VECTORS}
    assert {"fino-domina-3-ticks", "stock-de-cidra-a-10-por-cento", "festa-parada"} <= names


@pytest.mark.parametrize("vector", VECTORS, ids=lambda vector: vector.name)
def test_prices_match_the_typescript_engine(vector: PricingVector) -> None:
    results = replay(vector)
    assert len(results) == len(vector.steps)

    for result, step in zip(results, vector.steps, strict=True):
        assert result["tick"] == step.tick
        assert result["prices"] == step.expected_prices, (
            f"{vector.name} diverged at tick {step.tick}"
        )


@pytest.mark.parametrize("vector", VECTORS, ids=lambda vector: vector.name)
def test_smoothed_demand_matches(vector: PricingVector) -> None:
    for result, step in zip(replay(vector), vector.steps, strict=True):
        for product_id, expected in step.expected_demand.items():
            assert result["smoothedDemand"][product_id] == pytest.approx(expected, abs=1e-12)


@pytest.mark.parametrize("vector", VECTORS, ids=lambda vector: vector.name)
def test_prices_never_leave_their_range(vector: PricingVector) -> None:
    limits = {p.product_id: (p.min_price, p.max_price) for p in vector.products}

    for result in replay(vector):
        for product_id, price in result["prices"].items():
            low, high = limits[product_id]
            assert low <= price <= high
