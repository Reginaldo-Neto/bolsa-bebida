"""Engine parameters, mirroring packages/shared/src/constants.ts (spec 5.2)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

DEMAND_EPSILON = 1e-3
RENORMALIZE_EPSILON = 0.1
RENORMALIZE_MAX_ITERATIONS = 5
RENORMALIZE_TOLERANCE = 0.001


@dataclass(frozen=True)
class EngineParams:
    tick_seconds: int = 120
    ewma_lambda: float = 0.5
    demand_sensitivity: float = 0.10
    mean_reversion: float = 0.05
    stock_pressure: float = 0.05
    low_stock_threshold: float = 0.20
    max_step_pct: float = 0.08
    rounding_cents: int = 10
    renormalize: bool = True

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> "EngineParams":
        """Accepts the camelCase shape used by the shared test vectors."""
        return cls(
            tick_seconds=data["tickSeconds"],
            ewma_lambda=data["ewmaLambda"],
            demand_sensitivity=data["demandSensitivity"],
            mean_reversion=data["meanReversion"],
            stock_pressure=data["stockPressure"],
            low_stock_threshold=data["lowStockThreshold"],
            max_step_pct=data["maxStepPct"],
            rounding_cents=data["roundingCents"],
            renormalize=data["renormalize"],
        )


DEFAULT_ENGINE_PARAMS = EngineParams()
