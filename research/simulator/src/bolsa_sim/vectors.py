"""Loads and replays the shared test vectors of spec 5.6.

The JSON files live in packages/pricing-engine/test-vectors and are the single
source of truth shared by the production engine and this simulator.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, Mapping

from .engine import ManualOverride, ProductState, run_tick
from .params import EngineParams

VECTORS_DIR = (
    Path(__file__).resolve().parents[4] / "packages" / "pricing-engine" / "test-vectors"
)


@dataclass(frozen=True)
class VectorStep:
    tick: int
    paid_units: dict[str, int]
    expected_prices: dict[str, int]
    expected_demand: dict[str, float]


@dataclass(frozen=True)
class PricingVector:
    name: str
    description: str
    params: EngineParams
    products: list[ProductState]
    steps: list[VectorStep]


def _product_from_json(data: Mapping[str, Any]) -> ProductState:
    override = data.get("manualOverride")
    return ProductState(
        product_id=data["productId"],
        group_id=data["groupId"],
        base_price=data["basePrice"],
        min_price=data["minPrice"],
        max_price=data["maxPrice"],
        current_price=data["currentPrice"],
        smoothed_demand=data.get("smoothedDemand", 0.0),
        raw_price=data.get("rawPrice"),
        expected_share=data.get("expectedShare"),
        stock_initial=data.get("stockInitial", 0),
        stock_available=data.get("stockAvailable", 0),
        active=data.get("active", True),
        manual_override=(
            ManualOverride(price=override["price"], until_tick=override["untilTick"])
            if override
            else None
        ),
    )


def load_vector(path: Path) -> PricingVector:
    data = json.loads(path.read_text(encoding="utf8"))
    return PricingVector(
        name=data["name"],
        description=data["description"],
        params=EngineParams.from_json(data["params"]),
        products=[_product_from_json(item) for item in data["products"]],
        steps=[
            VectorStep(
                tick=step["tick"],
                paid_units=step["paidUnits"],
                expected_prices=step["expected"]["prices"],
                expected_demand=step["expected"]["smoothedDemand"],
            )
            for step in data["steps"]
        ],
    )


def load_all_vectors(directory: Path = VECTORS_DIR) -> Iterator[PricingVector]:
    for path in sorted(directory.glob("*.json")):
        yield load_vector(path)


def replay(vector: PricingVector) -> list[dict[str, Any]]:
    """Runs the vector and returns the state after each step."""
    products = list(vector.products)
    results: list[dict[str, Any]] = []

    for step in vector.steps:
        output = run_tick(step.tick, vector.params, products, step.paid_units)
        products = output.products
        results.append(
            {
                "tick": step.tick,
                "prices": {p.product_id: p.current_price for p in products},
                "smoothedDemand": {p.product_id: p.smoothed_demand for p in products},
            }
        )

    return results
