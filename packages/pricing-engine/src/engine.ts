import {
  DEMAND_EPSILON,
  RENORMALIZE_EPSILON,
  RENORMALIZE_MAX_ITERATIONS,
  RENORMALIZE_TOLERANCE,
  roundIntoRange,
} from '@bolsa/shared';
import type { ExplainEntry, ProductState, TickInput, TickOutput } from './types';
import { validateTickInput } from './validate';

function clip(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function overrideAppliesAt(product: ProductState, tick: number): boolean {
  return product.manualOverride !== undefined && tick <= product.manualOverride.untilTick;
}

const NEUTRAL_EXPLAIN: ExplainEntry = { x: 0, r: 0, k: 0, delta: 0, c: 1 };

interface Working {
  product: ProductState;
  /** New smoothed demand after the EWMA update. */
  demand: number;
  /** Unrounded price this tick started from. */
  previous: number;
  /** Candidate price as a float; rounded to cents only at the very end. */
  candidate: number;
  explain: ExplainEntry;
  /** Pinned products keep their price: the group cannot move them. */
  pinned: boolean;
}

function previousRawPrice(product: ProductState): number {
  return clip(product.rawPrice ?? product.currentPrice, product.minPrice, product.maxPrice);
}

/**
 * Spec 5.3, one tick of the market.
 *
 * Pure and deterministic: the same input always produces the same output, with
 * no clock, no randomness and no I/O. That is what lets the Python simulator in
 * research/simulator reproduce production prices from the shared test vectors.
 */
export function runTick(input: TickInput): TickOutput {
  validateTickInput(input);

  const { tick, params, products, paidUnits } = input;
  const explain: Record<string, ExplainEntry> = {};
  const output: ProductState[] = [];

  for (const group of groupByGroupId(products)) {
    output.push(...runGroup(group, tick, params, paidUnits, explain));
  }

  // Preserve the caller's product order, which keeps snapshots stable.
  const byId = new Map(output.map((product) => [product.productId, product]));
  return {
    tick,
    products: products.map((product) => byId.get(product.productId) ?? product),
    explain,
  };
}

function groupByGroupId(products: readonly ProductState[]): ProductState[][] {
  const groups = new Map<string, ProductState[]>();
  for (const product of products) {
    const bucket = groups.get(product.groupId);
    if (bucket) {
      bucket.push(product);
    } else {
      groups.set(product.groupId, [product]);
    }
  }
  return [...groups.values()];
}

function runGroup(
  group: readonly ProductState[],
  tick: number,
  params: TickInput['params'],
  paidUnits: Readonly<Record<string, number>>,
  explain: Record<string, ExplainEntry>,
): ProductState[] {
  const result: ProductState[] = [];
  const working: Working[] = [];

  // Sold-out products leave the calculation and keep their last price (spec 4.2).
  for (const product of group) {
    if (!product.active) {
      explain[product.productId] = { ...NEUTRAL_EXPLAIN };
      result.push({ ...product });
    }
  }

  const activeProducts = group.filter((product) => product.active);
  if (activeProducts.length === 0) {
    return result;
  }

  // Steps 1-2: smoothed demand. Every active product counts, including the ones
  // an admin has pinned, so their history stays usable once the pin expires.
  for (const product of activeProducts) {
    const units = paidUnits[product.productId] ?? 0;
    const demand = params.ewmaLambda * units + (1 - params.ewmaLambda) * product.smoothedDemand;
    const previous = previousRawPrice(product);
    working.push({
      product,
      demand,
      previous,
      candidate: previous,
      explain: { ...NEUTRAL_EXPLAIN },
      pinned: overrideAppliesAt(product, tick),
    });
  }

  const expectedShares = expectedSharesOf(activeProducts);
  const totalDemand = working.reduce((sum, entry) => sum + entry.demand, 0);
  const groupIsIdle = totalDemand < DEMAND_EPSILON;

  // Steps 3-9: per-product signals and the candidate price.
  for (const entry of working) {
    const { product } = entry;
    const expected = expectedShares.get(product.productId) ?? 0;
    const observed = groupIsIdle ? expected : entry.demand / totalDemand;

    const x = expected > 0 ? clip((observed - expected) / expected, -1, 1) : 0;
    const r = (entry.previous - product.basePrice) / product.basePrice;
    const stockRatio = product.stockInitial > 0 ? product.stockAvailable / product.stockInitial : 0;
    const k =
      params.lowStockThreshold > 0
        ? Math.max(0, params.lowStockThreshold - stockRatio) / params.lowStockThreshold
        : 0;

    if (entry.pinned) {
      entry.explain = { x, r, k, delta: 0, c: 1 };
      entry.candidate = product.manualOverride?.price ?? product.currentPrice;
      continue;
    }

    const delta = clip(
      params.demandSensitivity * x - params.meanReversion * r + params.stockPressure * k,
      -params.maxStepPct,
      params.maxStepPct,
    );

    entry.explain = { x, r, k, delta, c: 1 };
    entry.candidate = entry.previous * (1 + delta);
  }

  // Step 10: renormalisation keeps the group's weighted average near the base
  // average, so a surge in one drink pushes its substitutes down.
  const free = working.filter((entry) => !entry.pinned);
  if (params.renormalize && free.length > 0) {
    renormalizeGroup(free);
  }

  // Steps 11-12: re-apply the per-tick cap, the hard limits and the rounding.
  for (const entry of working) {
    const { product } = entry;
    const capped = entry.pinned
      ? entry.candidate
      : clip(
          entry.candidate,
          entry.previous * (1 - params.maxStepPct),
          entry.previous * (1 + params.maxStepPct),
        );
    const raw = clip(capped, product.minPrice, product.maxPrice);

    explain[product.productId] = entry.explain;
    result.push(
      nextState(
        product,
        roundIntoRange(raw, product.minPrice, product.maxPrice, params.roundingCents),
        raw,
        entry.demand,
        tick,
      ),
    );
  }

  return result;
}

function nextState(
  product: ProductState,
  price: number,
  rawPrice: number,
  demand: number,
  tick: number,
): ProductState {
  const next: ProductState = {
    ...product,
    currentPrice: price,
    rawPrice,
    smoothedDemand: demand,
  };
  if (product.manualOverride && !overrideAppliesAt(product, tick)) {
    delete next.manualOverride;
  }
  return next;
}

/**
 * Expected shares default to an even split and are normalised to sum to 1, so a
 * partially configured group still produces a usable demand signal.
 */
function expectedSharesOf(activeProducts: readonly ProductState[]): Map<string, number> {
  const evenShare = 1 / activeProducts.length;
  const raw = activeProducts.map((product) =>
    product.expectedShare !== undefined && product.expectedShare > 0
      ? product.expectedShare
      : evenShare,
  );
  const total = raw.reduce((sum, value) => sum + value, 0);

  return new Map(
    activeProducts.map((product, index) => [
      product.productId,
      total > 0 ? (raw[index] ?? 0) / total : 0,
    ]),
  );
}

function renormalizeGroup(free: Working[]): void {
  for (let iteration = 0; iteration < RENORMALIZE_MAX_ITERATIONS; iteration += 1) {
    let numerator = 0;
    let denominator = 0;

    for (const entry of free) {
      const weight = entry.demand + RENORMALIZE_EPSILON;
      numerator += weight * entry.product.basePrice;
      denominator += weight * entry.candidate;
    }

    if (denominator <= 0) {
      return;
    }

    const c = numerator / denominator;
    for (const entry of free) {
      entry.candidate = clip(c * entry.candidate, entry.product.minPrice, entry.product.maxPrice);
      // Cumulative across iterations, so `explain` reports the total correction.
      entry.explain.c *= c;
    }

    if (Math.abs(c - 1) < RENORMALIZE_TOLERANCE) {
      return;
    }
  }
}
