import { DEFAULT_ENGINE_PARAMS, type EngineParams } from '@bolsa/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runTick } from './engine';
import type { ProductState, TickOutput } from './types';

/**
 * Property-based checks for the invariants of spec 5.5. These are the
 * guarantees the event depends on: whatever the admin configures and whatever
 * the crowd buys, a price never leaves its range and never jumps.
 */

const paramsArb: fc.Arbitrary<EngineParams> = fc.record({
  tickSeconds: fc.constant(120),
  ewmaLambda: fc.double({ min: 0, max: 1, noNaN: true }),
  demandSensitivity: fc.double({ min: 0, max: 1, noNaN: true }),
  meanReversion: fc.double({ min: 0, max: 1, noNaN: true }),
  stockPressure: fc.double({ min: 0, max: 1, noNaN: true }),
  lowStockThreshold: fc.double({ min: 0, max: 1, noNaN: true }),
  maxStepPct: fc.double({ min: 0, max: 0.5, noNaN: true }),
  roundingCents: fc.constantFrom(1, 5, 10, 25, 50),
  renormalize: fc.boolean(),
});

interface ProductSeed {
  groupIndex: number;
  minPrice: number;
  baseOffset: number;
  maxOffset: number;
  priceOffset: number;
  smoothedDemand: number;
  stockInitial: number;
  stockRatio: number;
  active: boolean;
  paidUnits: number;
}

const productSeedArb: fc.Arbitrary<ProductSeed> = fc.record({
  groupIndex: fc.integer({ min: 0, max: 2 }),
  minPrice: fc.integer({ min: 10, max: 500 }),
  baseOffset: fc.integer({ min: 0, max: 400 }),
  maxOffset: fc.integer({ min: 0, max: 400 }),
  priceOffset: fc.double({ min: 0, max: 1, noNaN: true }),
  smoothedDemand: fc.double({ min: 0, max: 100, noNaN: true }),
  stockInitial: fc.integer({ min: 0, max: 1000 }),
  stockRatio: fc.double({ min: 0, max: 1, noNaN: true }),
  active: fc.boolean(),
  paidUnits: fc.integer({ min: 0, max: 200 }),
});

function buildScenario(seeds: readonly ProductSeed[]): {
  products: ProductState[];
  paidUnits: Record<string, number>;
} {
  const products: ProductState[] = [];
  const paidUnits: Record<string, number> = {};

  seeds.forEach((seed, index) => {
    const productId = `p${index}`;
    const minPrice = seed.minPrice;
    const basePrice = minPrice + seed.baseOffset;
    const maxPrice = basePrice + seed.maxOffset;
    const currentPrice = Math.round(minPrice + (maxPrice - minPrice) * seed.priceOffset);

    products.push({
      productId,
      groupId: `g${seed.groupIndex}`,
      basePrice,
      minPrice,
      maxPrice,
      currentPrice,
      smoothedDemand: seed.smoothedDemand,
      stockInitial: seed.stockInitial,
      stockAvailable: Math.round(seed.stockInitial * seed.stockRatio),
      active: seed.active,
    });
    paidUnits[productId] = seed.paidUnits;
  });

  return { products, paidUnits };
}

const scenarioArb = fc
  .array(productSeedArb, { minLength: 1, maxLength: 8 })
  .map(buildScenario)
  .chain((scenario) => paramsArb.map((params) => ({ ...scenario, params })));

const runScenario = (scenario: {
  products: ProductState[];
  paidUnits: Record<string, number>;
  params: EngineParams;
}): TickOutput =>
  runTick({
    tick: 1,
    params: scenario.params,
    products: scenario.products,
    paidUnits: scenario.paidUnits,
  });

describe('invariant: hard price limits', () => {
  it('keeps every price inside [minPrice, maxPrice]', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        for (const product of runScenario(scenario).products) {
          expect(product.currentPrice).toBeGreaterThanOrEqual(product.minPrice);
          expect(product.currentPrice).toBeLessThanOrEqual(product.maxPrice);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('keeps the carried raw price inside the range too', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        for (const product of runScenario(scenario).products) {
          if (product.rawPrice !== undefined) {
            expect(product.rawPrice).toBeGreaterThanOrEqual(product.minPrice);
            expect(product.rawPrice).toBeLessThanOrEqual(product.maxPrice);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('invariant: maximum change per tick', () => {
  it('never moves a price by more than delta plus one rounding step', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const before = new Map(scenario.products.map((p) => [p.productId, p.currentPrice]));
        const { maxStepPct, roundingCents } = scenario.params;

        for (const product of runScenario(scenario).products) {
          const previous = before.get(product.productId) ?? product.currentPrice;
          const allowed = previous * maxStepPct + roundingCents;
          expect(Math.abs(product.currentPrice - previous)).toBeLessThanOrEqual(allowed + 1e-9);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('invariant: rounding', () => {
  it('returns multiples of roundingCents, except when a bound is not one', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const before = new Map(scenario.products.map((p) => [p.productId, p.currentPrice]));
        const { roundingCents } = scenario.params;

        for (const product of runScenario(scenario).products) {
          const isMultiple = product.currentPrice % roundingCents === 0;
          const isBound =
            product.currentPrice === product.minPrice || product.currentPrice === product.maxPrice;
          const untouched = product.currentPrice === before.get(product.productId);
          expect(isMultiple || isBound || untouched).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('always returns integer cents', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        for (const product of runScenario(scenario).products) {
          expect(Number.isSafeInteger(product.currentPrice)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('invariant: determinism', () => {
  it('produces the same output for the same input', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        expect(runScenario(scenario)).toEqual(runScenario(scenario));
      }),
      { numRuns: 300 },
    );
  });

  it('leaves the input untouched', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const snapshot = structuredClone(scenario.products);
        runScenario(scenario);
        expect(scenario.products).toEqual(snapshot);
      }),
      { numRuns: 200 },
    );
  });
});

describe('invariant: convergence to the base price', () => {
  it('returns an idle market to its base prices', () => {
    const idleScenarioArb = fc
      .array(productSeedArb, { minLength: 1, maxLength: 5 })
      .map(buildScenario)
      .map(({ products }) => ({
        // Full stock, so low-stock pressure never holds the price above base.
        products: products.map((product) => ({
          ...product,
          active: true,
          stockInitial: 100,
          stockAvailable: 100,
        })),
      }));

    fc.assert(
      fc.property(idleScenarioArb, ({ products }) => {
        let state = products;
        for (let tick = 1; tick <= 400; tick += 1) {
          state = runTick({
            tick,
            params: DEFAULT_ENGINE_PARAMS,
            products: state,
            paidUnits: {},
          }).products;
        }

        for (const product of state) {
          // Within one rounding step: the base price itself need not be a multiple.
          expect(Math.abs(product.currentPrice - product.basePrice)).toBeLessThanOrEqual(
            DEFAULT_ENGINE_PARAMS.roundingCents,
          );
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe('invariant: manual override', () => {
  const overrideArb = fc
    .record({
      seed: productSeedArb,
      overridePrice: fc.integer({ min: -500, max: 2000 }),
      untilTick: fc.integer({ min: 0, max: 10 }),
      tick: fc.integer({ min: 0, max: 10 }),
    })
    .map(({ seed, overridePrice, untilTick, tick }) => {
      const { products, paidUnits } = buildScenario([
        seed,
        { ...seed, groupIndex: seed.groupIndex },
      ]);
      const withOverride = products.map((product, index) =>
        index === 0
          ? { ...product, active: true, manualOverride: { price: overridePrice, untilTick } }
          : { ...product, active: true },
      );
      return { products: withOverride, paidUnits, tick, untilTick, overridePrice };
    });

  it('respects the price limits and expires on the configured tick', () => {
    fc.assert(
      fc.property(overrideArb, ({ products, paidUnits, tick, untilTick }) => {
        const output = runTick({ tick, params: DEFAULT_ENGINE_PARAMS, products, paidUnits });
        const pinned = output.products[0];
        expect(pinned).toBeDefined();
        if (!pinned) {
          return;
        }

        expect(pinned.currentPrice).toBeGreaterThanOrEqual(pinned.minPrice);
        expect(pinned.currentPrice).toBeLessThanOrEqual(pinned.maxPrice);

        if (tick <= untilTick) {
          expect(pinned.manualOverride).toBeDefined();
        } else {
          expect(pinned.manualOverride).toBeUndefined();
        }
      }),
      { numRuns: 300 },
    );
  });
});
