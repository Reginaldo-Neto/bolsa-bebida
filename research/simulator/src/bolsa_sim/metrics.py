"""Output metrics of spec 13.2, used to compare parameter sets."""

from __future__ import annotations

import statistics
from dataclasses import dataclass

from .agents import SimulationResult


@dataclass(frozen=True)
class SimulationMetrics:
    revenue_cents: int
    units_sold: int
    # Mean absolute relative price change per tick, averaged over products.
    price_volatility: float
    # Fraction of (product, tick) pairs sitting exactly on a price bound.
    time_at_bound: float
    stockouts: int
    # Volume-weighted average price over base price, minus one. Zero means the
    # market was revenue-neutral against fixed base pricing.
    revenue_deviation: float
    # Distribution of (base - paid) / base across purchased units.
    mean_saving: float
    p10_saving: float
    p90_saving: float

    def as_row(self) -> dict[str, float]:
        return {
            "revenue_eur": self.revenue_cents / 100,
            "units_sold": self.units_sold,
            "price_volatility": self.price_volatility,
            "time_at_bound": self.time_at_bound,
            "stockouts": self.stockouts,
            "revenue_deviation": self.revenue_deviation,
            "mean_saving": self.mean_saving,
            "p10_saving": self.p10_saving,
            "p90_saving": self.p90_saving,
        }


def _percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(fraction * (len(ordered) - 1))))
    return ordered[index]


def compute_metrics(result: SimulationResult) -> SimulationMetrics:
    revenue = sum(purchase.unit_price for purchase in result.purchases)
    units = len(result.purchases)

    savings = [
        (purchase.base_price - purchase.unit_price) / purchase.base_price
        for purchase in result.purchases
        if purchase.base_price > 0
    ]

    base_revenue = sum(purchase.base_price for purchase in result.purchases)
    revenue_deviation = (revenue - base_revenue) / base_revenue if base_revenue else 0.0

    changes: list[float] = []
    bound_hits = 0
    observations = 0
    limits = {p.product_id: (p.min_price, p.max_price) for p in result.products}

    for index, row in enumerate(result.price_history):
        previous = result.price_history[index - 1] if index > 0 else None
        for product_id, price in row.items():
            observations += 1
            low, high = limits.get(product_id, (price, price))
            if price in (low, high):
                bound_hits += 1
            if previous and previous.get(product_id):
                changes.append(abs(price - previous[product_id]) / previous[product_id])

    stockouts = sum(1 for product in result.products if product.stock_available == 0)

    return SimulationMetrics(
        revenue_cents=revenue,
        units_sold=units,
        price_volatility=statistics.fmean(changes) if changes else 0.0,
        time_at_bound=bound_hits / observations if observations else 0.0,
        stockouts=stockouts,
        revenue_deviation=revenue_deviation,
        mean_saving=statistics.fmean(savings) if savings else 0.0,
        p10_saving=_percentile(savings, 0.1),
        p90_saving=_percentile(savings, 0.9),
    )
