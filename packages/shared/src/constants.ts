import type { Cents } from './money';

export const TIMEZONE = 'Europe/Lisbon';
export const DEFAULT_LOCALE = 'pt-PT';
export const SUPPORTED_LOCALES = ['pt-PT', 'en'] as const;

/** L1: the checkout price is locked while the quote is valid. */
export const QUOTE_TTL_SECONDS = 60;

/** Spec 4.4: stock stays reserved while the payment is PENDING. */
export const PAYMENT_TIMEOUT_SECONDS = 240;

/** Spec 6.1: fallback polling when the payment webhook does not arrive. */
export const PAYMENT_POLL_INTERVAL_SECONDS = 15;

/** Spec 4.4: default cap per product per order. */
export const DEFAULT_MAX_QTY_PER_PRODUCT = 4;

/** L8: responsible drinking limit, configurable per event. */
export const DEFAULT_ALCOHOL_UNITS_PER_WINDOW = 4;
export const DEFAULT_ALCOHOL_WINDOW_MINUTES = 30;

/** Spec 4.6: "Melhor Trader" scoring. */
export const LEADERBOARD_MAX_SCORED_UNITS = 10;
export const LEADERBOARD_MIN_UNITS = 2;
export const LEADERBOARD_SCORE_MULTIPLIER = 1000;
export const LEADERBOARD_TOP_SIZE = 20;
export const SCREEN_LEADERBOARD_TOP_SIZE = 5;

/** Spec 4.5 / 10.3: voucher identifiers. */
export const VOUCHER_SHORT_CODE_LENGTH = 6;
/** Excludes I, O, 0, 1 to stay readable in a dark, noisy venue. */
export const VOUCHER_SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const VOUCHER_QR_PREFIX = 'BB1';

/** L7 / 12.2: personal data is anonymised this many days after the event. */
export const DEFAULT_RETENTION_DAYS = 30;

/**
 * L3 (DL 109-G/2021): price-reduction wording is forbidden anywhere in the
 * product. Use "cotacao" and "variacao" instead.
 */
export const FORBIDDEN_PRICE_WORDS = [
  'promocao',
  'promocoes',
  'desconto',
  'descontos',
  'saldo',
  'saldos',
  'poupe',
  'oferta',
  'ofertas',
  'promotion',
  'discount',
  'sale',
] as const;

export interface EngineParams {
  /** T: seconds between price updates. */
  tickSeconds: number;
  /** lambda: weight of this tick's sales in the smoothed demand. */
  ewmaLambda: number;
  /** alpha: strength of the demand response. */
  demandSensitivity: number;
  /** beta: strength of the pull back to the base price. */
  meanReversion: number;
  /** gamma: strength of the low-stock pressure. */
  stockPressure: number;
  /** theta: stock fraction below which pressure kicks in. */
  lowStockThreshold: number;
  /** delta: maximum change per tick. */
  maxStepPct: number;
  /** Price rounding granularity, in cents. */
  roundingCents: number;
  /** Keeps the weighted average price of each group near the base average. */
  renormalize: boolean;
}

export const DEFAULT_ENGINE_PARAMS: EngineParams = {
  tickSeconds: 120,
  ewmaLambda: 0.5,
  demandSensitivity: 0.1,
  meanReversion: 0.05,
  stockPressure: 0.05,
  lowStockThreshold: 0.2,
  maxStepPct: 0.08,
  roundingCents: 10,
  renormalize: true,
};

export interface EventLimits {
  maxQtyPerProduct: number;
  alcoholUnitsPerWindow: number;
  alcoholWindowMinutes: number;
  quoteTtlSeconds: number;
  paymentTimeoutSeconds: number;
}

export const DEFAULT_EVENT_LIMITS: EventLimits = {
  maxQtyPerProduct: DEFAULT_MAX_QTY_PER_PRODUCT,
  alcoholUnitsPerWindow: DEFAULT_ALCOHOL_UNITS_PER_WINDOW,
  alcoholWindowMinutes: DEFAULT_ALCOHOL_WINDOW_MINUTES,
  quoteTtlSeconds: QUOTE_TTL_SECONDS,
  paymentTimeoutSeconds: PAYMENT_TIMEOUT_SECONDS,
};

/** Renormalisation epsilon of spec 5.3 step 10. */
export const RENORMALIZE_EPSILON = 0.1;
export const RENORMALIZE_MAX_ITERATIONS = 5;
export const RENORMALIZE_TOLERANCE = 0.001;

/** Stock display buckets used by the market UI. */
export const LOW_STOCK_DISPLAY_THRESHOLD = 0.2;

export const MIN_PRODUCT_PRICE_CENTS: Cents = 10;
