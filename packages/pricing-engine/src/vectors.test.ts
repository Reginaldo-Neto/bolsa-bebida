import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runVector, type TestVector } from './vectors';

/**
 * Spec 5.6: the same JSON files are replayed by the Python simulator in
 * research/simulator, so a divergence between research and production code
 * fails a test instead of surprising the organiser during the party.
 */
const vectorsDir = join(__dirname, '..', 'test-vectors');
const files = readdirSync(vectorsDir).filter((file) => file.endsWith('.json'));

describe('shared test vectors', () => {
  it('ships at least the scenarios named in spec 5.6', () => {
    expect(files).toContain('fino-domina-3-ticks.json');
    expect(files).toContain('stock-de-cidra-a-10-por-cento.json');
    expect(files).toContain('festa-parada.json');
  });

  it.each(files)('%s reproduces its expected prices', (file) => {
    const vector = JSON.parse(readFileSync(join(vectorsDir, file), 'utf8')) as TestVector;
    const results = runVector(vector);

    expect(results).toHaveLength(vector.steps.length);
    results.forEach((result, index) => {
      const step = vector.steps[index];
      expect(step).toBeDefined();
      if (!step) {
        return;
      }

      expect(result.tick).toBe(step.tick);
      expect(result.prices).toEqual(step.expected.prices);

      for (const [productId, expected] of Object.entries(step.expected.smoothedDemand)) {
        expect(result.smoothedDemand[productId]).toBeCloseTo(expected, 9);
      }
    });
  });

  it.each(files)('%s never leaves the price range', (file) => {
    const vector = JSON.parse(readFileSync(join(vectorsDir, file), 'utf8')) as TestVector;
    const limits = new Map(
      vector.products.map((product) => [
        product.productId,
        { min: product.minPrice, max: product.maxPrice },
      ]),
    );

    for (const result of runVector(vector)) {
      for (const [productId, price] of Object.entries(result.prices)) {
        const limit = limits.get(productId);
        expect(limit).toBeDefined();
        expect(price).toBeGreaterThanOrEqual(limit?.min ?? 0);
        expect(price).toBeLessThanOrEqual(limit?.max ?? 0);
      }
    }
  });
});

describe('fino-domina-3-ticks', () => {
  it('raises the fino and lowers its substitutes', () => {
    const vector = JSON.parse(
      readFileSync(join(vectorsDir, 'fino-domina-3-ticks.json'), 'utf8'),
    ) as TestVector;
    const last = runVector(vector).at(-1);

    expect(last).toBeDefined();
    expect(last?.prices.fino).toBeGreaterThan(150);
    expect(last?.prices.cidra).toBeLessThan(150);
  });
});

describe('festa-parada', () => {
  it('ends closer to the base prices than it started', () => {
    const vector = JSON.parse(
      readFileSync(join(vectorsDir, 'festa-parada.json'), 'utf8'),
    ) as TestVector;
    const bases = new Map(vector.products.map((p) => [p.productId, p.basePrice]));
    const distance = (prices: Record<string, number>) =>
      Object.entries(prices).reduce(
        (sum, [id, price]) => sum + Math.abs(price - (bases.get(id) ?? price)),
        0,
      );

    const start = vector.products.reduce(
      (sum, p) => sum + Math.abs(p.currentPrice - p.basePrice),
      0,
    );
    const results = runVector(vector);
    const end = distance(results.at(-1)?.prices ?? {});

    expect(end).toBeLessThan(start);
  });
});
