"""Command line entry point: `bolsa-sim run` and `bolsa-sim sweep`."""

from __future__ import annotations

import argparse
from dataclasses import replace
from pathlib import Path

from .agents import SimulationConfig, simulate
from .catalog import ALCOHOLIC, default_catalog
from .metrics import compute_metrics
from .money import format_cents
from .params import DEFAULT_ENGINE_PARAMS
from .sweep import run_sweep, write_csv
from .vectors import load_all_vectors, replay


def _run(args: argparse.Namespace) -> int:
    products = default_catalog()
    config = SimulationConfig(
        ticks=args.ticks,
        agents=args.agents,
        seed=args.seed,
        alcoholic_products=ALCOHOLIC,
    )
    result = simulate(products, DEFAULT_ENGINE_PARAMS, config)
    metrics = compute_metrics(result)

    print(f"{config.agents} participantes, {config.ticks} ticks, semente {config.seed}")
    print(f"Receita:           {format_cents(metrics.revenue_cents)}")
    print(f"Unidades vendidas: {metrics.units_sold}")
    print(f"Volatilidade:      {metrics.price_volatility:.4f}")
    print(f"Tempo em limite:   {metrics.time_at_bound:.2%}")
    print(f"Desvio de receita: {metrics.revenue_deviation:+.2%}")
    print(f"Poupanca media:    {metrics.mean_saving:+.2%}")
    print(f"Esgotados:         {metrics.stockouts}")
    print()
    print("Precos finais:")
    for product in result.products:
        print(f"  {product.product_id:<12} {format_cents(product.current_price)}")

    return 0


def _sweep(args: argparse.Namespace) -> int:
    points = run_sweep(
        config=replace(SimulationConfig(), ticks=args.ticks, agents=args.agents),
        seeds=tuple(range(1, args.seeds + 1)),
    )
    write_csv(points, Path(args.out))
    print(f"{len(points)} combinacoes escritas em {args.out}")
    return 0


def _verify(_: argparse.Namespace) -> int:
    """Re-checks the Python port against the shared vectors (spec 5.6)."""
    failures = 0
    for vector in load_all_vectors():
        for result, step in zip(replay(vector), vector.steps, strict=True):
            if result["prices"] != step.expected_prices:
                failures += 1
                print(f"DIVERGENCIA em {vector.name}, tick {step.tick}")
                print(f"  esperado: {step.expected_prices}")
                print(f"  obtido:   {result['prices']}")
        print(f"{'ok' if not failures else 'falhou'}: {vector.name}")

    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="bolsa-sim", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="simula uma festa")
    run.add_argument("--ticks", type=int, default=120)
    run.add_argument("--agents", type=int, default=200)
    run.add_argument("--seed", type=int, default=42)
    run.set_defaults(handler=_run)

    sweep = sub.add_parser("sweep", help="varre parametros e escreve um CSV")
    sweep.add_argument("--ticks", type=int, default=60)
    sweep.add_argument("--agents", type=int, default=150)
    sweep.add_argument("--seeds", type=int, default=3)
    sweep.add_argument("--out", default="out/sweep.csv")
    sweep.set_defaults(handler=_sweep)

    verify = sub.add_parser("verify", help="confirma paridade com o motor TypeScript")
    verify.set_defaults(handler=_verify)

    args = parser.parse_args()
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
