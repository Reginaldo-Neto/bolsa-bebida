import { DEFAULT_ENGINE_PARAMS, type EngineParams } from '@bolsa/shared';
import type { ProductState } from '../src/types';

/**
 * Scenario definitions for the shared test vectors of spec 5.6. The expected
 * output is filled in by scripts/generate-vectors.ts; these are the inputs.
 */
export interface ScenarioDefinition {
  name: string;
  description: string;
  params: EngineParams;
  products: ProductState[];
  steps: { tick: number; paidUnits: Record<string, number> }[];
}

function beer(productId: string, overrides: Partial<ProductState> = {}): ProductState {
  return {
    productId,
    groupId: 'cerveja-e-cidra',
    basePrice: 150,
    minPrice: 100,
    maxPrice: 250,
    currentPrice: 150,
    smoothedDemand: 0,
    stockInitial: 500,
    stockAvailable: 500,
    active: true,
    ...overrides,
  };
}

export const SCENARIOS: ScenarioDefinition[] = [
  {
    name: 'fino-domina-3-ticks',
    description:
      'O fino leva metade da procura do grupo durante tres ticks. O preco do fino sobe e os ' +
      'substitutos (imperial e cidra) descem, mantendo o preco medio ponderado perto do base.',
    params: DEFAULT_ENGINE_PARAMS,
    products: [beer('fino'), beer('imperial'), beer('cidra')],
    steps: [
      { tick: 1, paidUnits: { fino: 15, imperial: 8, cidra: 7 } },
      { tick: 2, paidUnits: { fino: 18, imperial: 9, cidra: 9 } },
      { tick: 3, paidUnits: { fino: 20, imperial: 10, cidra: 10 } },
    ],
  },
  {
    name: 'stock-de-cidra-a-10-por-cento',
    description:
      'A cidra esta a 10% do stock inicial, abaixo do limiar de 20%: a pressao de stock empurra ' +
      'o preco para cima mesmo com procura equilibrada.',
    params: DEFAULT_ENGINE_PARAMS,
    products: [
      beer('fino'),
      beer('imperial'),
      beer('cidra', { stockAvailable: 50, stockInitial: 500 }),
    ],
    steps: [
      { tick: 1, paidUnits: { fino: 10, imperial: 10, cidra: 10 } },
      { tick: 2, paidUnits: { fino: 10, imperial: 10, cidra: 10 } },
      { tick: 3, paidUnits: { fino: 10, imperial: 10, cidra: 10 } },
    ],
  },
  {
    name: 'festa-parada',
    description:
      'Depois de uma rajada de vendas a festa para. As quotas de procura sobrevivem a paragem ' +
      '(so o nivel absoluto decai), por isso os precos ainda se afastam do base durante cerca de ' +
      '14 ticks antes de a reversao a media os trazer de volta. E o comportamento da formula da ' +
      'seccao 5.3: calibrar alpha e beta no simulador se o transitorio for demasiado agressivo.',
    params: DEFAULT_ENGINE_PARAMS,
    products: [
      beer('fino', { currentPrice: 200, smoothedDemand: 12 }),
      beer('imperial', { currentPrice: 130, smoothedDemand: 2 }),
      beer('cidra', { currentPrice: 120, smoothedDemand: 1 }),
    ],
    steps: Array.from({ length: 40 }, (_, index) => ({ tick: index + 1, paidUnits: {} })),
  },
  {
    name: 'esgotado-sai-do-calculo',
    description:
      'O fino esgota: sai do calculo do motor, mantem o ultimo preco e os restantes produtos ' +
      'repartem entre si a quota esperada do grupo (spec 4.2).',
    params: DEFAULT_ENGINE_PARAMS,
    products: [
      beer('fino', { active: false, stockAvailable: 0, currentPrice: 210 }),
      beer('imperial'),
      beer('cidra'),
    ],
    steps: [
      { tick: 1, paidUnits: { imperial: 20, cidra: 4 } },
      { tick: 2, paidUnits: { imperial: 22, cidra: 3 } },
    ],
  },
  {
    name: 'override-do-admin',
    description:
      'O admin fixa o preco do fino em 2,20 EUR ate ao tick 3. Enquanto dura, o preco nao se move ' +
      'e o produto sai da renormalizacao; a partir do tick 4 volta a flutuar.',
    params: DEFAULT_ENGINE_PARAMS,
    products: [
      beer('fino', { manualOverride: { price: 220, untilTick: 3 } }),
      beer('imperial'),
      beer('cidra'),
    ],
    steps: [
      { tick: 1, paidUnits: { fino: 20, imperial: 5, cidra: 5 } },
      { tick: 2, paidUnits: { fino: 20, imperial: 5, cidra: 5 } },
      { tick: 3, paidUnits: { fino: 20, imperial: 5, cidra: 5 } },
      { tick: 4, paidUnits: { fino: 20, imperial: 5, cidra: 5 } },
      { tick: 5, paidUnits: { fino: 20, imperial: 5, cidra: 5 } },
    ],
  },
  {
    name: 'limites-rigidos',
    description:
      'Intervalo apertado e procura extrema: o preco nunca sai de [min, max] nem salta mais do ' +
      'que delta por tick.',
    params: { ...DEFAULT_ENGINE_PARAMS, renormalize: false },
    products: [
      beer('fino', { minPrice: 140, maxPrice: 160, currentPrice: 150 }),
      beer('cidra', { minPrice: 140, maxPrice: 160, currentPrice: 150 }),
    ],
    steps: [
      { tick: 1, paidUnits: { fino: 500 } },
      { tick: 2, paidUnits: { fino: 500 } },
      { tick: 3, paidUnits: { fino: 500 } },
      { tick: 4, paidUnits: { cidra: 500 } },
    ],
  },
];
