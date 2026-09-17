import { DEFAULT_ENGINE_PARAMS } from '@bolsa/shared';
import { describe, expect, it } from 'vitest';
import type { ProductState, TickInput } from './types';
import { EngineInputError, engineWarnings, validateTickInput } from './validate';

function product(overrides: Partial<ProductState> = {}): ProductState {
  return {
    productId: 'fino',
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

function input(overrides: Partial<TickInput> = {}): TickInput {
  return {
    tick: 1,
    params: DEFAULT_ENGINE_PARAMS,
    products: [product()],
    paidUnits: {},
    ...overrides,
  };
}

describe('validateTickInput: product fields', () => {
  const cases: [string, Partial<ProductState>, RegExp][] = [
    ['an empty productId', { productId: '' }, /productId/],
    ['a missing groupId', { groupId: '' }, /groupId/],
    ['a fractional basePrice', { basePrice: 150.5 }, /basePrice/],
    ['a fractional minPrice', { minPrice: 100.5 }, /minPrice/],
    ['a fractional maxPrice', { maxPrice: 250.5 }, /maxPrice/],
    ['a fractional currentPrice', { currentPrice: 150.5 }, /currentPrice/],
    ['a zero basePrice', { basePrice: 0, minPrice: 0 }, /basePrice must be positive/],
    ['an inverted range', { minPrice: 300, maxPrice: 200, basePrice: 250 }, /exceeds maxPrice/],
    ['a base outside the range', { basePrice: 300, maxPrice: 250 }, /inside \[minPrice/],
    ['a price outside the range', { currentPrice: 999 }, /is outside/],
    ['a non-finite rawPrice', { rawPrice: Number.NaN }, /rawPrice/],
    ['a negative smoothedDemand', { smoothedDemand: -1 }, /smoothedDemand/],
    ['a NaN smoothedDemand', { smoothedDemand: Number.NaN }, /smoothedDemand/],
    ['a negative expectedShare', { expectedShare: -0.5 }, /expectedShare/],
    ['a NaN expectedShare', { expectedShare: Number.NaN }, /expectedShare/],
    ['a fractional stockInitial', { stockInitial: 10.5 }, /stockInitial/],
    ['a negative stockInitial', { stockInitial: -1 }, /stockInitial/],
    ['a fractional stockAvailable', { stockAvailable: 10.5 }, /stockAvailable/],
    ['a negative stockAvailable', { stockAvailable: -1 }, /stockAvailable/],
    [
      'a fractional override price',
      { manualOverride: { price: 150.5, untilTick: 2 } },
      /manualOverride/,
    ],
  ];

  it.each(cases)('rejects %s', (_label, overrides, message) => {
    expect(() => validateTickInput(input({ products: [product(overrides)] }))).toThrow(message);
    expect(() => validateTickInput(input({ products: [product(overrides)] }))).toThrow(
      EngineInputError,
    );
  });

  it('accepts a well-formed product', () => {
    expect(() => validateTickInput(input())).not.toThrow();
  });

  it('accepts a zero-width price range', () => {
    expect(() =>
      validateTickInput(
        input({ products: [product({ minPrice: 150, maxPrice: 150, currentPrice: 150 })] }),
      ),
    ).not.toThrow();
  });
});

describe('validateTickInput: tick and params', () => {
  it('rejects a fractional or negative tick', () => {
    expect(() => validateTickInput(input({ tick: 1.5 }))).toThrow(/tick/);
    expect(() => validateTickInput(input({ tick: -1 }))).toThrow(/tick/);
  });

  it('rejects duplicate product ids', () => {
    expect(() => validateTickInput(input({ products: [product(), product()] }))).toThrow(
      /duplicate productId/,
    );
  });

  it('rejects invalid paid units', () => {
    expect(() => validateTickInput(input({ paidUnits: { fino: -1 } }))).toThrow(/paidUnits/);
    expect(() => validateTickInput(input({ paidUnits: { fino: 1.5 } }))).toThrow(/paidUnits/);
  });

  it('rejects parameters outside their domain', () => {
    const withParams = (overrides: Partial<typeof DEFAULT_ENGINE_PARAMS>) =>
      input({ params: { ...DEFAULT_ENGINE_PARAMS, ...overrides } });

    expect(() => validateTickInput(withParams({ roundingCents: 0 }))).toThrow(/roundingCents/);
    expect(() => validateTickInput(withParams({ roundingCents: 1.5 }))).toThrow(/roundingCents/);
    expect(() => validateTickInput(withParams({ maxStepPct: -0.1 }))).toThrow(/maxStepPct/);
    expect(() => validateTickInput(withParams({ maxStepPct: 1.1 }))).toThrow(/maxStepPct/);
    expect(() => validateTickInput(withParams({ ewmaLambda: 1.1 }))).toThrow(/ewmaLambda/);
    expect(() => validateTickInput(withParams({ ewmaLambda: -0.1 }))).toThrow(/ewmaLambda/);
    expect(() => validateTickInput(withParams({ lowStockThreshold: 1.1 }))).toThrow(
      /lowStockThreshold/,
    );
    expect(() => validateTickInput(withParams({ lowStockThreshold: -0.1 }))).toThrow(
      /lowStockThreshold/,
    );
  });
});

describe('engineWarnings', () => {
  it('warns about a zero-width range', () => {
    const warnings = engineWarnings(
      input({
        products: [
          product({ productId: 'a', minPrice: 150, maxPrice: 150 }),
          product({ productId: 'b', minPrice: 150, maxPrice: 150 }),
        ],
      }),
    );
    expect(warnings.some((warning) => warning.includes('zero-width'))).toBe(true);
  });

  it('ignores inactive products when sizing a group', () => {
    const warnings = engineWarnings(
      input({
        products: [
          product({ productId: 'a' }),
          product({ productId: 'b', active: false }),
          product({ productId: 'c', active: false }),
        ],
      }),
    );
    expect(warnings.some((warning) => warning.includes('single active product'))).toBe(true);
  });

  it('says nothing when renormalisation is off', () => {
    const warnings = engineWarnings(
      input({ params: { ...DEFAULT_ENGINE_PARAMS, renormalize: false } }),
    );
    expect(warnings).toEqual([]);
  });
});
