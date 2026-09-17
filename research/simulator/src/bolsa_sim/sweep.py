"""Parameter sweep for calibrating alpha, beta, gamma and delta (spec 13.2)."""

from __future__ import annotations

import csv
import itertools
from dataclasses import dataclass, fields as dataclass_fields, replace
from pathlib import Path
from typing import Iterable, Sequence

from .agents import SimulationConfig, simulate
from .catalog import default_catalog
from .engine import ProductState
from .metrics import SimulationMetrics, compute_metrics
from .params import DEFAULT_ENGINE_PARAMS, EngineParams


@dataclass(frozen=True)
class SweepPoint:
    params: EngineParams
    metrics: SimulationMetrics
    seed: int


DEFAULT_GRID: dict[str, Sequence[float]] = {
    "demand_sensitivity": (0.05, 0.10, 0.20),
    "mean_reversion": (0.02, 0.05, 0.10),
    "stock_pressure": (0.0, 0.05, 0.10),
    "max_step_pct": (0.04, 0.08),
}


def grid_points(grid: dict[str, Sequence[float]] | None = None) -> Iterable[EngineParams]:
    grid = grid or DEFAULT_GRID
    keys = list(grid)
    for combination in itertools.product(*(grid[key] for key in keys)):
        yield replace(DEFAULT_ENGINE_PARAMS, **dict(zip(keys, combination, strict=True)))


def run_sweep(
    products: Sequence[ProductState] | None = None,
    config: SimulationConfig | None = None,
    grid: dict[str, Sequence[float]] | None = None,
    seeds: Sequence[int] = (1, 2, 3),
) -> list[SweepPoint]:
    """Runs every grid point over several seeds, so noise does not pick the winner."""
    products = list(products or default_catalog())
    base_config = config or SimulationConfig()
    results: list[SweepPoint] = []

    for params in grid_points(grid):
        for seed in seeds:
            result = simulate(products, params, replace(base_config, seed=seed))
            results.append(
                SweepPoint(params=params, metrics=compute_metrics(result), seed=seed)
            )

    return results


def write_csv(points: Sequence[SweepPoint], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    swept = ["demand_sensitivity", "mean_reversion", "stock_pressure", "max_step_pct"]
    metric_names = [item.name for item in dataclass_fields(SimulationMetrics)]

    with path.open("w", newline="", encoding="utf8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["seed", *swept, *metric_names])
        writer.writeheader()
        for point in points:
            writer.writerow(
                {
                    "seed": point.seed,
                    **{name: getattr(point.params, name) for name in swept},
                    **{name: getattr(point.metrics, name) for name in metric_names},
                }
            )
