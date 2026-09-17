import type { Cents, EngineParams } from '@bolsa/shared';

/** Spec 4.7: an admin pins a price, inside the range, for a number of ticks. */
export interface ManualOverride {
  price: Cents;
  /** Last tick the override applies to; from the next tick the price is free. */
  untilTick: number;
}

export interface ProductState {
  productId: string;
  groupId: string;
  basePrice: Cents;
  minPrice: Cents;
  maxPrice: Cents;
  /** The price actually shown and charged: always an integer of cents. */
  currentPrice: Cents;
  /**
   * The unrounded price carried between ticks. Without it, a move smaller than
   * half a rounding step is lost every tick and an idle market never returns to
   * its base price, breaking the convergence invariant of spec 5.5.
   * Defaults to `currentPrice` when absent.
   */
  rawPrice?: number;
  /** EWMA of paid units per tick. */
  smoothedDemand: number;
  /** Expected share of the group's demand. Defaults to 1 / (active products). */
  expectedShare?: number;
  stockInitial: number;
  stockAvailable: number;
  /** Sold-out products leave the calculation entirely (spec 4.2). */
  active: boolean;
  manualOverride?: ManualOverride;
}

export interface TickInput {
  /** Sequence number of the tick being computed. */
  tick: number;
  params: EngineParams;
  products: ProductState[];
  /** productId -> units paid during this tick. Only PAID sales count (spec 5.1). */
  paidUnits: Record<string, number>;
}

/** Signals behind each price move, kept for the admin dashboard and the thesis. */
export interface ExplainEntry {
  /** Demand signal: clipped relative deviation from the expected share. */
  x: number;
  /** Deviation from the base price. */
  r: number;
  /** Low-stock pressure. */
  k: number;
  /** Applied relative change before renormalisation. */
  delta: number;
  /** Group renormalisation factor applied to this product. */
  c: number;
}

export interface TickOutput {
  tick: number;
  products: ProductState[];
  explain: Record<string, ExplainEntry>;
}
