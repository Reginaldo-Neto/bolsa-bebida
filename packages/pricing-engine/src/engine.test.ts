import { DEFAULT_ENGINE_PARAMS, type EngineParams } from '@bolsa/shared';
import { describe, expect, it } from 'vitest';
import { runTick } from './engine';
import type { ProductState, TickInput } from './types';
import { EngineInputError, engineWarnings } from './validate';

function product(overrides: Partial<ProductState> & { productId: string }): ProductState {
  return {
    groupId: 'cerveja',
    basePrice: 150,
    minPrice: 100,
    maxPrice: 250,
    currentPrice: 150,
    smoothedDemand: 0,
    stockInitial: 100,
    stockAvailable: 100,
    active: true,
    ...overrides,
  };
}

function tickInput(
  products: ProductState[],
  paidUnits: Record<string, number> = {},
  params: Partial<EngineParams> = {},
  tick = 1,
): TickInput {
  return { tick, products, paidUnits, params: { ...DEFAULT_ENGINE_PARAMS, ...params } };
}

const beerGroup = () => [
  product({ productId: 'fino' }),
  product({ productId: 'imperial' }),
  product({ productId: 'cidra' }),
];

describe('runTick: demand moves prices inside a group', () => {
  it('raises the drink that sells above its expected share and lowers its substitutes', () => {
    const output = runTick(
      tickInput(beerGroup(), { fino: 15, imperial: 8, cidra: 7 }, { roundingCents: 10 }),
    );

    const prices = Object.fromEntries(output.products.map((p) => [p.productId, p.currentPrice]));
    expect(prices).toEqual({ fino: 160, imperial: 150, cidra: 140 });
  });

  it('records the signals behind each move', () => {
    const output = runTick(tickInput(beerGroup(), { fino: 15, imperial: 8, cidra: 7 }));

    const fino = output.explain.fino;
    expect(fino).toBeDefined();
    // fino took 50% of demand against an expected 33%.
    expect(fino?.x).toBeCloseTo(0.5, 6);
    expect(fino?.r).toBe(0);
    expect(fino?.k).toBe(0);
    expect(fino?.delta).toBeCloseTo(0.05, 6);
    // The group correction pulls the weighted average back towards the base.
    expect(fino?.c).toBeLessThan(1);
    expect(output.explain.cidra?.x).toBeCloseTo(-0.3, 6);
  });

  it('keeps the weighted average price of the group near the base average', () => {
    const output = runTick(tickInput(beerGroup(), { fino: 15, imperial: 8, cidra: 7 }));

    const weight = (p: ProductState) => p.smoothedDemand + 0.1;
    const weighted = output.products.reduce((sum, p) => sum + weight(p) * p.currentPrice, 0);
    const baseWeighted = output.products.reduce((sum, p) => sum + weight(p) * p.basePrice, 0);

    // Within one rounding step of the base average.
    expect(Math.abs(weighted - baseWeighted) / baseWeighted).toBeLessThan(0.02);
  });

  it('pins the winner near the base price when demand is fully concentrated', () => {
    // Revenue neutrality (spec 5.1) wins over the demand signal here: if every
    // sale is a fino, the average price paid IS the fino price, so it cannot
    // rise without the group's average rising with it. The substitutes absorb
    // the whole movement instead.
    const output = runTick(tickInput(beerGroup(), { fino: 30 }));

    const prices = Object.fromEntries(output.products.map((p) => [p.productId, p.currentPrice]));
    expect(prices.fino).toBe(150);
    expect(prices.cidra).toBeLessThan(150);
    expect(prices.imperial).toBeLessThan(150);
  });

  it('does not move a product whose demand matches its expected share', () => {
    const output = runTick(tickInput(beerGroup(), { fino: 10, imperial: 10, cidra: 10 }));

    for (const p of output.products) {
      expect(p.currentPrice).toBe(150);
    }
  });

  it('honours a per-product expected share', () => {
    const products = [
      product({ productId: 'fino', expectedShare: 0.6 }),
      product({ productId: 'cidra', expectedShare: 0.4 }),
    ];
    // Selling exactly at the configured shares must leave prices untouched.
    const output = runTick(tickInput(products, { fino: 60, cidra: 40 }));

    expect(output.products.map((p) => p.currentPrice)).toEqual([150, 150]);
  });
});

describe('runTick: mean reversion', () => {
  it('walks an idle market back to the base price', () => {
    let products = [
      product({ productId: 'fino', currentPrice: 200 }),
      product({ productId: 'cidra', currentPrice: 120 }),
    ];

    const distance = () =>
      products.reduce((sum, p) => sum + Math.abs(p.currentPrice - p.basePrice), 0);

    const start = distance();
    for (let tick = 1; tick <= 20; tick += 1) {
      products = runTick(tickInput(products, {}, {}, tick)).products;
    }
    const afterTwenty = distance();

    for (let tick = 21; tick <= 200; tick += 1) {
      products = runTick(tickInput(products, {}, {}, tick)).products;
    }

    expect(afterTwenty).toBeLessThan(start);
    expect(products.map((p) => p.currentPrice)).toEqual([150, 150]);
  });

  it('stays put once every price equals its base', () => {
    const products = beerGroup();
    const output = runTick(tickInput(products, {}));

    expect(output.products.map((p) => p.currentPrice)).toEqual([150, 150, 150]);
  });
});

describe('runTick: stock pressure', () => {
  it('pushes the price up when stock runs low', () => {
    const products = [
      product({ productId: 'fino', stockAvailable: 10, stockInitial: 100 }),
      product({ productId: 'cidra' }),
    ];
    const output = runTick(
      tickInput(products, {}, { renormalize: false, roundingCents: 1, meanReversion: 0 }),
    );

    // k = (0.20 - 0.10) / 0.20 = 0.5, so delta = gamma * 0.5 = 0.025.
    expect(output.explain.fino?.k).toBeCloseTo(0.5, 6);
    expect(output.products[0]?.currentPrice).toBe(154);
    expect(output.products[1]?.currentPrice).toBe(150);
  });

  it('ignores stock pressure above the threshold', () => {
    const products = [product({ productId: 'fino', stockAvailable: 50, stockInitial: 100 })];
    const output = runTick(tickInput(products, {}, { renormalize: false }));

    expect(output.explain.fino?.k).toBe(0);
  });
});

describe('runTick: hard limits (spec 5.1)', () => {
  it('never exceeds the maximum price, however strong the demand', () => {
    const products = [
      product({ productId: 'fino', currentPrice: 250, maxPrice: 250, stockAvailable: 1 }),
      product({ productId: 'cidra', currentPrice: 250, maxPrice: 250, stockAvailable: 1 }),
    ];
    const output = runTick(tickInput(products, { fino: 500 }, { renormalize: false }));

    for (const p of output.products) {
      expect(p.currentPrice).toBeLessThanOrEqual(p.maxPrice);
    }
  });

  it('never drops below the minimum price', () => {
    const products = [
      product({ productId: 'fino', currentPrice: 100, minPrice: 100 }),
      product({ productId: 'cidra', currentPrice: 100, minPrice: 100 }),
    ];
    const output = runTick(tickInput(products, { cidra: 100 }, { renormalize: false }));

    for (const p of output.products) {
      expect(p.currentPrice).toBeGreaterThanOrEqual(p.minPrice);
    }
  });

  it('caps the change per tick', () => {
    const products = [
      product({ productId: 'fino' }),
      product({ productId: 'cidra', currentPrice: 240 }),
    ];
    const output = runTick(
      tickInput(products, { fino: 1000 }, { renormalize: false, demandSensitivity: 1 }),
    );

    // +8% of 150 = 162, rounded to the nearest 10 cents.
    expect(output.products[0]?.currentPrice).toBe(160);
  });
});

describe('runTick: sold-out products', () => {
  it('freezes the price of an inactive product and leaves it out of the group', () => {
    const products = [
      product({ productId: 'fino', active: false, stockAvailable: 0, currentPrice: 210 }),
      product({ productId: 'imperial' }),
      product({ productId: 'cidra' }),
    ];
    const output = runTick(tickInput(products, { imperial: 20 }));

    expect(output.products[0]?.currentPrice).toBe(210);
    expect(output.products[0]?.smoothedDemand).toBe(0);
    expect(output.explain.fino).toEqual({ x: 0, r: 0, k: 0, delta: 0, c: 1 });
    // The two active products split the expected share between them.
    expect(output.products[1]?.currentPrice).toBeGreaterThan(
      output.products[2]?.currentPrice ?? Number.POSITIVE_INFINITY,
    );
  });
});

describe('runTick: manual override (spec 4.7)', () => {
  it('pins the price inside the range while the override lasts', () => {
    const products = [
      product({ productId: 'fino', manualOverride: { price: 220, untilTick: 3 } }),
      product({ productId: 'cidra' }),
    ];
    const output = runTick(tickInput(products, { fino: 50 }, {}, 2));

    expect(output.products[0]?.currentPrice).toBe(220);
    expect(output.products[0]?.manualOverride).toEqual({ price: 220, untilTick: 3 });
    expect(output.explain.fino?.delta).toBe(0);
  });

  it('clamps an override that sits outside the product range', () => {
    const products = [product({ productId: 'fino', manualOverride: { price: 900, untilTick: 5 } })];
    const output = runTick(tickInput(products, {}, {}, 1));

    expect(output.products[0]?.currentPrice).toBe(250);
  });

  it('expires after the configured tick and frees the price again', () => {
    const products = [
      product({ productId: 'fino', manualOverride: { price: 220, untilTick: 3 } }),
      product({ productId: 'cidra' }),
    ];
    const output = runTick(tickInput(products, {}, {}, 4));

    expect(output.products[0]?.manualOverride).toBeUndefined();
    expect(output.products[0]?.currentPrice).not.toBe(220);
  });

  it('keeps updating the smoothed demand of a pinned product', () => {
    const products = [
      product({ productId: 'fino', manualOverride: { price: 220, untilTick: 3 } }),
      product({ productId: 'cidra' }),
    ];
    const output = runTick(tickInput(products, { fino: 10 }, {}, 2));

    expect(output.products[0]?.smoothedDemand).toBe(5);
  });
});

describe('runTick: purity', () => {
  it('is deterministic', () => {
    const input = tickInput(beerGroup(), { fino: 12, cidra: 3 });
    expect(runTick(input)).toEqual(runTick(input));
  });

  it('does not mutate its input', () => {
    const products = beerGroup();
    const snapshot = structuredClone(products);
    runTick(tickInput(products, { fino: 12, cidra: 3 }));

    expect(products).toEqual(snapshot);
  });

  it('preserves the order of the products it was given', () => {
    const products = [
      product({ productId: 'agua', groupId: 'sem-alcool' }),
      product({ productId: 'fino' }),
      product({ productId: 'sumo', groupId: 'sem-alcool' }),
    ];
    const output = runTick(tickInput(products, {}));

    expect(output.products.map((p) => p.productId)).toEqual(['agua', 'fino', 'sumo']);
  });
});

describe('validation', () => {
  it('rejects a price outside the product range', () => {
    const products = [product({ productId: 'fino', currentPrice: 999 })];
    expect(() => runTick(tickInput(products))).toThrow(EngineInputError);
  });

  it('rejects an inverted range and a non-integer price', () => {
    expect(() => runTick(tickInput([product({ productId: 'x', minPrice: 300 })]))).toThrow(
      EngineInputError,
    );
    expect(() => runTick(tickInput([product({ productId: 'x', currentPrice: 150.5 })]))).toThrow(
      EngineInputError,
    );
  });

  it('rejects duplicate product ids and negative sales', () => {
    expect(() =>
      runTick(tickInput([product({ productId: 'x' }), product({ productId: 'x' })])),
    ).toThrow(/duplicate/);
    expect(() => runTick(tickInput([product({ productId: 'x' })], { x: -1 }))).toThrow(
      EngineInputError,
    );
  });

  it('warns when renormalisation would pin a lone product to its base price', () => {
    const warnings = engineWarnings(tickInput([product({ productId: 'agua', groupId: 'agua' })]));
    expect(warnings[0]).toMatch(/single active product/);
  });

  it('stays quiet for a healthy group', () => {
    expect(engineWarnings(tickInput(beerGroup()))).toEqual([]);
  });
});
