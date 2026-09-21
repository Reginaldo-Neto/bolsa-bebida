/**
 * Money is always an integer number of euro cents. Never a float.
 * Spec 0.4: "Dinheiro e sempre inteiro em centimos de euro."
 */
export type Cents = number;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertCents(value: unknown, label = 'value'): asserts value is Cents {
  if (!isCents(value)) {
    throw new MoneyError(`${label} must be a safe integer of cents, got: ${String(value)}`);
  }
}

export function assertNonNegativeCents(value: unknown, label = 'value'): asserts value is Cents {
  assertCents(value, label);
  if (value < 0) {
    throw new MoneyError(`${label} must not be negative, got: ${value}`);
  }
}

export function addCents(...values: Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    assertCents(value, 'operand');
    total += value;
  }
  assertCents(total, 'sum');
  return total;
}

export function multiplyCents(unitPrice: Cents, quantity: number): Cents {
  assertCents(unitPrice, 'unitPrice');
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new MoneyError(`quantity must be a non-negative integer, got: ${String(quantity)}`);
  }
  const total = unitPrice * quantity;
  assertCents(total, 'total');
  return total;
}

export function clampCents(value: Cents, min: Cents, max: Cents): Cents {
  assertCents(value, 'value');
  assertCents(min, 'min');
  assertCents(max, 'max');
  if (min > max) {
    throw new MoneyError(`min (${min}) must not exceed max (${max})`);
  }
  return Math.min(Math.max(value, min), max);
}

/** Rounds to the nearest multiple of `step`, halves away from zero. */
export function roundToStep(value: number, step: number): Cents {
  if (!Number.isSafeInteger(step) || step <= 0) {
    throw new MoneyError(`step must be a positive integer, got: ${String(step)}`);
  }
  if (!Number.isFinite(value)) {
    throw new MoneyError(`value must be finite, got: ${String(value)}`);
  }
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value) / step) * step;
}

/**
 * Rounds to a multiple of `step` while staying inside [min, max].
 * When a bound is not itself a multiple of `step`, the bound wins over the
 * multiple: the hard price limits of spec 5.1 are never violated.
 */
export function roundIntoRange(value: number, min: Cents, max: Cents, step: number): Cents {
  assertCents(min, 'min');
  assertCents(max, 'max');
  if (min > max) {
    throw new MoneyError(`min (${min}) must not exceed max (${max})`);
  }

  const clamped = Math.min(Math.max(value, min), max);
  const rounded = roundToStep(clamped, step);
  if (rounded > max) {
    const down = Math.floor(max / step) * step;
    return down >= min ? down : nearestBound(clamped, min, max);
  }
  if (rounded < min) {
    const up = Math.ceil(min / step) * step;
    return up <= max ? up : nearestBound(clamped, min, max);
  }
  return rounded;
}

/** Ties go to `min`: when in doubt the participant pays the lower price. */
function nearestBound(value: number, min: Cents, max: Cents): Cents {
  return value - min <= max - value ? min : max;
}

export interface FormatCentsOptions {
  locale?: string;
  currency?: string;
  /** Omits the currency symbol, e.g. for compact tickers. */
  withoutSymbol?: boolean;
}

export function formatCents(value: Cents, options: FormatCentsOptions = {}): string {
  assertCents(value, 'value');
  const { locale = 'pt-PT', currency = 'EUR', withoutSymbol = false } = options;
  return new Intl.NumberFormat(locale, {
    style: withoutSymbol ? 'decimal' : 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

/** Parses "1,50" / "1.50" / 1.5 into 150 cents. Rejects sub-cent precision. */
export function eurosToCents(input: string | number): Cents {
  const normalized = typeof input === 'string' ? input.trim().replace(',', '.') : input;
  const euros = Number(normalized);
  if (!Number.isFinite(euros)) {
    throw new MoneyError(`cannot parse euros from: ${String(input)}`);
  }
  const cents = Math.round(euros * 100);
  if (Math.abs(euros * 100 - cents) > 1e-6) {
    throw new MoneyError(`value has sub-cent precision: ${String(input)}`);
  }
  assertCents(cents, 'cents');
  return cents;
}

/**
 * Change owed at the till.
 *
 * Cash is the one place in this product where money moves back the other way,
 * and a cashier working it out in their head at two in the morning with a
 * queue in front of them is how a drawer ends the night short.
 */
export function changeForCash(totalCents: Cents, receivedCents: Cents): Cents {
  assertNonNegativeCents(totalCents, 'totalCents');
  assertNonNegativeCents(receivedCents, 'receivedCents');
  if (receivedCents < totalCents) {
    throw new MoneyError(`received (${receivedCents}) is less than the total (${totalCents})`);
  }
  return receivedCents - totalCents;
}

/** Percentage change against a base price, as a ratio (0.08 = +8%). */
export function changeRatio(current: Cents, base: Cents): number {
  assertCents(current, 'current');
  assertCents(base, 'base');
  if (base === 0) {
    throw new MoneyError('base price must not be zero');
  }
  return (current - base) / base;
}
