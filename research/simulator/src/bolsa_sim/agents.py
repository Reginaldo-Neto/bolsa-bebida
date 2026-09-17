"""Agent-based simulation of a party (spec 13.2).

Each participant has drink preferences, a price sensitivity, an arrival rate
and a budget. At every tick the arriving participants pick a drink with a
multinomial logit over price-adjusted utility, which is the standard discrete
choice model in the dynamic pricing literature (den Boer, 2015). The purpose is
to calibrate alpha, beta, gamma and delta before the party, not to predict it.

The model is deterministic for a given seed: two runs with the same
configuration produce byte-identical results, so a parameter sweep compares
parameters rather than luck.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field, replace
from typing import Sequence

from .engine import ProductState, run_tick
from .params import EngineParams


@dataclass(frozen=True)
class AgentProfile:
    """One participant."""

    agent_id: int
    # productId -> relative taste, before price is considered.
    preferences: dict[str, float]
    # Higher means more willing to switch drinks when a price moves.
    price_sensitivity: float
    # Probability of walking to the bar in a given tick.
    arrival_rate: float
    budget_cents: int


@dataclass
class Purchase:
    tick: int
    agent_id: int
    product_id: str
    unit_price: int
    base_price: int


@dataclass
class SimulationConfig:
    ticks: int = 120
    agents: int = 200
    seed: int = 42
    # Spread of individual price sensitivity across the crowd.
    price_sensitivity_mean: float = 2.0
    price_sensitivity_sd: float = 0.8
    arrival_rate_mean: float = 0.06
    budget_cents: int = 3000
    # L8: an agent stops buying alcohol after this many units per window.
    alcohol_units_per_window: int = 4
    alcohol_window_ticks: int = 15
    alcoholic_products: frozenset[str] = frozenset()


@dataclass
class SimulationResult:
    config: SimulationConfig
    params: EngineParams
    products: list[ProductState]
    purchases: list[Purchase]
    # One row per tick: productId -> price.
    price_history: list[dict[str, int]] = field(default_factory=list)
    # One row per tick: productId -> units paid.
    sales_history: list[dict[str, int]] = field(default_factory=list)


def build_agents(config: SimulationConfig, product_ids: Sequence[str]) -> list[AgentProfile]:
    rng = random.Random(config.seed)
    agents: list[AgentProfile] = []

    for agent_id in range(config.agents):
        preferences = {product_id: rng.expovariate(1.0) + 0.05 for product_id in product_ids}
        sensitivity = max(
            0.1, rng.gauss(config.price_sensitivity_mean, config.price_sensitivity_sd)
        )
        arrival = min(1.0, max(0.0, rng.expovariate(1 / config.arrival_rate_mean)))
        agents.append(
            AgentProfile(
                agent_id=agent_id,
                preferences=preferences,
                price_sensitivity=sensitivity,
                arrival_rate=arrival,
                budget_cents=config.budget_cents,
            )
        )

    return agents


def _choose_product(
    agent: AgentProfile,
    products: Sequence[ProductState],
    rng: random.Random,
) -> ProductState | None:
    """Multinomial logit over utility = ln(taste) - sensitivity * ln(price / base)."""
    candidates: list[tuple[ProductState, float]] = []

    for product in products:
        if not product.active or product.stock_available <= 0:
            continue
        if product.current_price > agent.budget_cents:
            continue
        taste = agent.preferences.get(product.product_id, 0.0)
        if taste <= 0:
            continue
        utility = math.log(taste) - agent.price_sensitivity * math.log(
            product.current_price / product.base_price
        )
        candidates.append((product, utility))

    if not candidates:
        return None

    highest = max(utility for _, utility in candidates)
    weights = [math.exp(utility - highest) for _, utility in candidates]
    total = sum(weights)
    threshold = rng.random() * total

    cumulative = 0.0
    for (product, _), weight in zip(candidates, weights, strict=True):
        cumulative += weight
        if cumulative >= threshold:
            return product
    return candidates[-1][0]


def simulate(
    products: Sequence[ProductState],
    params: EngineParams,
    config: SimulationConfig | None = None,
) -> SimulationResult:
    config = config or SimulationConfig()
    rng = random.Random(config.seed + 1)
    agents = build_agents(config, [product.product_id for product in products])

    state = list(products)
    budgets = {agent.agent_id: agent.budget_cents for agent in agents}
    # agentId -> ticks at which an alcoholic unit was bought (L8 window).
    alcohol_log: dict[int, list[int]] = {agent.agent_id: [] for agent in agents}

    result = SimulationResult(config=config, params=params, products=list(products), purchases=[])

    for tick in range(1, config.ticks + 1):
        paid_units: dict[str, int] = {}
        by_id = {product.product_id: product for product in state}

        for agent in agents:
            if rng.random() >= agent.arrival_rate:
                continue

            affordable = replace(agent, budget_cents=budgets[agent.agent_id])
            recent_alcohol = [
                t for t in alcohol_log[agent.agent_id] if tick - t < config.alcohol_window_ticks
            ]
            alcohol_log[agent.agent_id] = recent_alcohol

            available = [
                product
                for product in state
                if not (
                    product.product_id in config.alcoholic_products
                    and len(recent_alcohol) >= config.alcohol_units_per_window
                )
            ]

            chosen = _choose_product(affordable, available, rng)
            if chosen is None:
                continue

            budgets[agent.agent_id] -= chosen.current_price
            paid_units[chosen.product_id] = paid_units.get(chosen.product_id, 0) + 1
            if chosen.product_id in config.alcoholic_products:
                alcohol_log[agent.agent_id].append(tick)

            result.purchases.append(
                Purchase(
                    tick=tick,
                    agent_id=agent.agent_id,
                    product_id=chosen.product_id,
                    unit_price=chosen.current_price,
                    base_price=chosen.base_price,
                )
            )

            sold = by_id[chosen.product_id]
            updated = replace(sold, stock_available=max(0, sold.stock_available - 1))
            by_id[chosen.product_id] = updated
            state = [by_id[product.product_id] for product in state]

        # Stock reaching zero takes the product out of the engine (spec 4.2).
        state = [
            replace(product, active=product.active and product.stock_available > 0)
            for product in state
        ]

        state = run_tick(tick, params, state, paid_units).products

        result.price_history.append({p.product_id: p.current_price for p in state})
        result.sales_history.append(dict(paid_units))

    result.products = state
    return result
