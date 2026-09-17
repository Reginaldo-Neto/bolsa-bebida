"""A plausible Portuguese party catalogue, used as the simulator's default."""

from __future__ import annotations

from .engine import ProductState

ALCOHOLIC = frozenset({"fino", "imperial", "cidra", "sangria", "gin-tonico"})


def default_catalog() -> list[ProductState]:
    """Prices in cents. Water is always present and free of charge (L8)."""
    return [
        ProductState(
            product_id="fino",
            group_id="cerveja-e-cidra",
            base_price=150,
            min_price=100,
            max_price=250,
            current_price=150,
            stock_initial=600,
            stock_available=600,
        ),
        ProductState(
            product_id="imperial",
            group_id="cerveja-e-cidra",
            base_price=150,
            min_price=100,
            max_price=250,
            current_price=150,
            stock_initial=400,
            stock_available=400,
        ),
        ProductState(
            product_id="cidra",
            group_id="cerveja-e-cidra",
            base_price=200,
            min_price=150,
            max_price=300,
            current_price=200,
            stock_initial=250,
            stock_available=250,
        ),
        ProductState(
            product_id="sangria",
            group_id="cocktails",
            base_price=350,
            min_price=250,
            max_price=500,
            current_price=350,
            stock_initial=200,
            stock_available=200,
        ),
        ProductState(
            product_id="gin-tonico",
            group_id="cocktails",
            base_price=450,
            min_price=350,
            max_price=650,
            current_price=450,
            stock_initial=200,
            stock_available=200,
        ),
        ProductState(
            product_id="sumo",
            group_id="sem-alcool",
            base_price=150,
            min_price=100,
            max_price=200,
            current_price=150,
            stock_initial=300,
            stock_available=300,
        ),
        ProductState(
            product_id="agua",
            group_id="sem-alcool",
            base_price=100,
            min_price=50,
            max_price=100,
            current_price=100,
            stock_initial=800,
            stock_available=800,
        ),
    ]
