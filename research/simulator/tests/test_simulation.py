"""The simulator must be reproducible, or a parameter sweep just measures noise."""

from __future__ import annotations

from dataclasses import replace

from bolsa_sim.agents import SimulationConfig, simulate
from bolsa_sim.catalog import ALCOHOLIC, default_catalog
from bolsa_sim.metrics import compute_metrics
from bolsa_sim.params import DEFAULT_ENGINE_PARAMS
from bolsa_sim.sweep import grid_points, run_sweep

CONFIG = SimulationConfig(ticks=30, agents=60, seed=7, alcoholic_products=ALCOHOLIC)


def test_same_seed_gives_the_same_party() -> None:
    first = simulate(default_catalog(), DEFAULT_ENGINE_PARAMS, CONFIG)
    second = simulate(default_catalog(), DEFAULT_ENGINE_PARAMS, CONFIG)

    assert first.price_history == second.price_history
    assert first.sales_history == second.sales_history


def test_different_seeds_give_different_parties() -> None:
    first = simulate(default_catalog(), DEFAULT_ENGINE_PARAMS, CONFIG)
    second = simulate(default_catalog(), DEFAULT_ENGINE_PARAMS, replace(CONFIG, seed=8))

    assert first.sales_history != second.sales_history


def test_prices_stay_inside_their_range() -> None:
    result = simulate(default_catalog(), DEFAULT_ENGINE_PARAMS, CONFIG)
    limits = {p.product_id: (p.min_price, p.max_price) for p in default_catalog()}

    for row in result.price_history:
        for product_id, price in row.items():
            low, high = limits[product_id]
            assert low <= price <= high


def test_stock_never_goes_negative() -> None:
    result = simulate(default_catalog(), DEFAULT_ENGINE_PARAMS, CONFIG)
    assert all(product.stock_available >= 0 for product in result.products)


def test_units_sold_match_the_sales_history() -> None:
    result = simulate(default_catalog(), DEFAULT_ENGINE_PARAMS, CONFIG)
    from_history = sum(sum(row.values()) for row in result.sales_history)
    assert from_history == len(result.purchases)


def test_alcohol_window_limits_each_agent() -> None:
    config = replace(CONFIG, alcohol_units_per_window=1, alcohol_window_ticks=1000, agents=20)
    result = simulate(default_catalog(), DEFAULT_ENGINE_PARAMS, config)

    per_agent: dict[int, int] = {}
    for purchase in result.purchases:
        if purchase.product_id in ALCOHOLIC:
            per_agent[purchase.agent_id] = per_agent.get(purchase.agent_id, 0) + 1

    assert per_agent, "the simulation should still sell some alcohol"
    assert max(per_agent.values()) == 1


def test_metrics_are_consistent() -> None:
    result = simulate(default_catalog(), DEFAULT_ENGINE_PARAMS, CONFIG)
    metrics = compute_metrics(result)

    assert metrics.units_sold == len(result.purchases)
    assert metrics.revenue_cents == sum(p.unit_price for p in result.purchases)
    assert 0.0 <= metrics.time_at_bound <= 1.0
    assert metrics.price_volatility >= 0.0


def test_grid_covers_every_combination() -> None:
    assert len(list(grid_points())) == 3 * 3 * 3 * 2


def test_sweep_runs_every_point_for_every_seed() -> None:
    grid = {"demand_sensitivity": (0.05, 0.2), "mean_reversion": (0.05,)}
    points = run_sweep(config=replace(CONFIG, ticks=5, agents=10), grid=grid, seeds=(1, 2))

    assert len(points) == 4
    assert {point.params.demand_sensitivity for point in points} == {0.05, 0.2}
