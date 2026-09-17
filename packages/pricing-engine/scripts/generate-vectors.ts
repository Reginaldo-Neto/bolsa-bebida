import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTick } from '../src/engine';
import type { TestVector, TestVectorStep } from '../src/vectors';
import { SCENARIOS, type ScenarioDefinition } from './scenarios';

/**
 * Regenerates packages/pricing-engine/test-vectors/*.json.
 *
 * The expected values come from the engine itself: the vectors are a
 * regression net and the contract with the Python simulator, not an
 * independent oracle. Correctness is pinned by the hand-computed assertions in
 * src/engine.test.ts and the property tests in src/invariants.test.ts.
 */
function buildVector(scenario: ScenarioDefinition): TestVector {
  let products = scenario.products.map((product) => ({ ...product }));
  const steps: TestVectorStep[] = [];

  for (const step of scenario.steps) {
    const output = runTick({
      tick: step.tick,
      params: scenario.params,
      products,
      paidUnits: step.paidUnits,
    });
    products = output.products;

    const prices: Record<string, number> = {};
    const smoothedDemand: Record<string, number> = {};
    for (const product of products) {
      prices[product.productId] = product.currentPrice;
      smoothedDemand[product.productId] = product.smoothedDemand;
    }

    steps.push({
      tick: step.tick,
      paidUnits: step.paidUnits,
      expected: { prices, smoothedDemand },
    });
  }

  return {
    name: scenario.name,
    description: scenario.description,
    params: scenario.params,
    products: scenario.products,
    steps,
  };
}

const outputDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-vectors');
mkdirSync(outputDir, { recursive: true });

for (const scenario of SCENARIOS) {
  const vector = buildVector(scenario);
  const file = join(outputDir, `${scenario.name}.json`);
  writeFileSync(file, `${JSON.stringify(vector, null, 2)}\n`, 'utf8');
  console.log(`wrote ${file}`);
}
