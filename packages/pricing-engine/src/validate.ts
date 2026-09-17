import { isCents } from '@bolsa/shared';
import type { ProductState, TickInput } from './types';

export class EngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineInputError';
  }
}

function fail(message: string): never {
  throw new EngineInputError(message);
}

function validateProduct(product: ProductState): void {
  const id = product.productId;
  if (!id) {
    fail('every product needs a productId');
  }
  if (!product.groupId) {
    fail(`product ${id}: groupId is required`);
  }

  for (const [label, value] of [
    ['basePrice', product.basePrice],
    ['minPrice', product.minPrice],
    ['maxPrice', product.maxPrice],
    ['currentPrice', product.currentPrice],
  ] as const) {
    if (!isCents(value)) {
      fail(`product ${id}: ${label} must be an integer of cents, got ${String(value)}`);
    }
  }

  if (product.basePrice <= 0) {
    fail(`product ${id}: basePrice must be positive`);
  }
  if (product.minPrice > product.maxPrice) {
    fail(`product ${id}: minPrice (${product.minPrice}) exceeds maxPrice (${product.maxPrice})`);
  }
  if (product.basePrice < product.minPrice || product.basePrice > product.maxPrice) {
    fail(`product ${id}: basePrice must sit inside [minPrice, maxPrice]`);
  }
  if (product.currentPrice < product.minPrice || product.currentPrice > product.maxPrice) {
    fail(
      `product ${id}: currentPrice (${product.currentPrice}) is outside ` +
        `[${product.minPrice}, ${product.maxPrice}]; clamp it before ticking`,
    );
  }

  if (product.rawPrice !== undefined && !Number.isFinite(product.rawPrice)) {
    fail(`product ${id}: rawPrice must be a finite number`);
  }
  if (!Number.isFinite(product.smoothedDemand) || product.smoothedDemand < 0) {
    fail(`product ${id}: smoothedDemand must be a non-negative number`);
  }
  if (product.expectedShare !== undefined) {
    if (!Number.isFinite(product.expectedShare) || product.expectedShare < 0) {
      fail(`product ${id}: expectedShare must be a non-negative number`);
    }
  }
  if (!Number.isInteger(product.stockInitial) || product.stockInitial < 0) {
    fail(`product ${id}: stockInitial must be a non-negative integer`);
  }
  if (!Number.isInteger(product.stockAvailable) || product.stockAvailable < 0) {
    fail(`product ${id}: stockAvailable must be a non-negative integer`);
  }
  if (product.manualOverride && !isCents(product.manualOverride.price)) {
    fail(`product ${id}: manualOverride.price must be an integer of cents`);
  }
}

export function validateTickInput(input: TickInput): void {
  if (!Number.isInteger(input.tick) || input.tick < 0) {
    fail(`tick must be a non-negative integer, got ${String(input.tick)}`);
  }

  const seen = new Set<string>();
  for (const product of input.products) {
    validateProduct(product);
    if (seen.has(product.productId)) {
      fail(`duplicate productId: ${product.productId}`);
    }
    seen.add(product.productId);
  }

  for (const [productId, units] of Object.entries(input.paidUnits)) {
    if (!Number.isInteger(units) || units < 0) {
      fail(`paidUnits[${productId}] must be a non-negative integer, got ${String(units)}`);
    }
  }

  const { params } = input;
  if (!Number.isInteger(params.roundingCents) || params.roundingCents <= 0) {
    fail('params.roundingCents must be a positive integer');
  }
  if (params.maxStepPct < 0 || params.maxStepPct > 1) {
    fail('params.maxStepPct must be between 0 and 1');
  }
  if (params.ewmaLambda < 0 || params.ewmaLambda > 1) {
    fail('params.ewmaLambda must be between 0 and 1');
  }
  if (params.lowStockThreshold < 0 || params.lowStockThreshold > 1) {
    fail('params.lowStockThreshold must be between 0 and 1');
  }
}

/**
 * Configuration smells that are legal but will surprise the organiser.
 * Surfaced in the admin panel rather than thrown.
 */
export function engineWarnings(input: TickInput): string[] {
  const warnings: string[] = [];
  const groups = new Map<string, ProductState[]>();

  for (const product of input.products) {
    if (!product.active) {
      continue;
    }
    const bucket = groups.get(product.groupId);
    if (bucket) {
      bucket.push(product);
    } else {
      groups.set(product.groupId, [product]);
    }
  }

  for (const [groupId, products] of groups) {
    if (input.params.renormalize && products.length < 2) {
      warnings.push(
        `group ${groupId} has a single active product: renormalisation pins it to the base ` +
          `price, so its quote will not react to demand. Add a substitute or disable renormalize.`,
      );
    }
    if (products.every((product) => product.minPrice === product.maxPrice)) {
      warnings.push(`group ${groupId}: every product has a zero-width price range`);
    }
  }

  return warnings;
}
