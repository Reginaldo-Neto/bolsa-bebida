import type { Cents, EngineParams } from '@bolsa/shared';
import { runTick } from './engine';
import type { ProductState } from './types';

/**
 * Shared test vectors (spec 5.6). The same JSON files drive the TypeScript
 * tests and the Python simulator, which is what keeps the research code and
 * the production engine honest about each other.
 */
export interface TestVectorStep {
  tick: number;
  paidUnits: Record<string, number>;
  expected: {
    prices: Record<string, Cents>;
    smoothedDemand: Record<string, number>;
  };
}

export interface TestVector {
  name: string;
  description: string;
  params: EngineParams;
  products: ProductState[];
  steps: TestVectorStep[];
}

export interface VectorStepResult {
  tick: number;
  prices: Record<string, Cents>;
  smoothedDemand: Record<string, number>;
}

/** Replays a vector from its initial state and returns the state after each step. */
export function runVector(vector: TestVector): VectorStepResult[] {
  let products = vector.products.map((product) => ({ ...product }));
  const results: VectorStepResult[] = [];

  for (const step of vector.steps) {
    const output = runTick({
      tick: step.tick,
      params: vector.params,
      products,
      paidUnits: step.paidUnits,
    });
    products = output.products;

    const prices: Record<string, Cents> = {};
    const smoothedDemand: Record<string, number> = {};
    for (const product of products) {
      prices[product.productId] = product.currentPrice;
      smoothedDemand[product.productId] = product.smoothedDemand;
    }
    results.push({ tick: step.tick, prices, smoothedDemand });
  }

  return results;
}
