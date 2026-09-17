import { describe, expect, it } from 'vitest';
import {
  addCents,
  assertCents,
  changeRatio,
  clampCents,
  eurosToCents,
  formatCents,
  isCents,
  MoneyError,
  multiplyCents,
  roundIntoRange,
  roundToStep,
} from './money';

describe('isCents / assertCents', () => {
  it('accepts safe integers', () => {
    expect(isCents(0)).toBe(true);
    expect(isCents(150)).toBe(true);
    expect(isCents(-150)).toBe(true);
  });

  it('rejects floats, NaN and non-numbers', () => {
    expect(isCents(1.5)).toBe(false);
    expect(isCents(Number.NaN)).toBe(false);
    expect(isCents(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isCents('150')).toBe(false);
    expect(() => assertCents(1.5, 'price')).toThrow(MoneyError);
  });
});

describe('addCents / multiplyCents', () => {
  it('adds integer amounts', () => {
    expect(addCents(150, 250, 100)).toBe(500);
    expect(addCents()).toBe(0);
  });

  it('multiplies by whole quantities', () => {
    expect(multiplyCents(150, 3)).toBe(450);
    expect(multiplyCents(150, 0)).toBe(0);
  });

  it('rejects fractional quantities', () => {
    expect(() => multiplyCents(150, 1.5)).toThrow(MoneyError);
    expect(() => multiplyCents(150, -1)).toThrow(MoneyError);
  });
});

describe('clampCents', () => {
  it('keeps the value inside the range', () => {
    expect(clampCents(50, 100, 200)).toBe(100);
    expect(clampCents(250, 100, 200)).toBe(200);
    expect(clampCents(150, 100, 200)).toBe(150);
  });

  it('rejects an inverted range', () => {
    expect(() => clampCents(150, 200, 100)).toThrow(MoneyError);
  });
});

describe('roundToStep', () => {
  it('rounds to the nearest multiple', () => {
    expect(roundToStep(144, 10)).toBe(140);
    expect(roundToStep(145, 10)).toBe(150);
    expect(roundToStep(149, 10)).toBe(150);
    expect(roundToStep(150, 10)).toBe(150);
  });

  it('supports a step of 1 (no rounding)', () => {
    expect(roundToStep(147, 1)).toBe(147);
  });

  it('rejects invalid steps', () => {
    expect(() => roundToStep(147, 0)).toThrow(MoneyError);
    expect(() => roundToStep(147, -10)).toThrow(MoneyError);
    expect(() => roundToStep(Number.NaN, 10)).toThrow(MoneyError);
  });
});

describe('roundIntoRange', () => {
  it('rounds to a step inside the range', () => {
    expect(roundIntoRange(147, 100, 200, 10)).toBe(150);
  });

  it('never exceeds the maximum, even when rounding up would', () => {
    expect(roundIntoRange(199, 100, 195, 10)).toBe(190);
  });

  it('never drops below the minimum, even when rounding down would', () => {
    expect(roundIntoRange(101, 105, 200, 10)).toBe(110);
  });

  it('falls back to the nearest bound when no multiple fits in the range', () => {
    expect(roundIntoRange(104, 101, 109, 10)).toBe(101);
    expect(roundIntoRange(107, 101, 109, 10)).toBe(109);
    expect(roundIntoRange(102, 101, 104, 10)).toBe(101);
  });

  it('respects a zero-width range', () => {
    expect(roundIntoRange(500, 133, 133, 10)).toBe(133);
  });
});

describe('formatCents', () => {
  it('formats in pt-PT with two decimals', () => {
    // Intl uses a narrow no-break space before the symbol in pt-PT.
    expect(formatCents(150).replace(/\s/g, ' ')).toBe('1,50 €');
    expect(formatCents(0).replace(/\s/g, ' ')).toBe('0,00 €');
  });

  it('can omit the symbol', () => {
    expect(formatCents(1234, { withoutSymbol: true })).toBe('12,34');
  });
});

describe('eurosToCents', () => {
  it('parses decimal comma and point', () => {
    expect(eurosToCents('1,50')).toBe(150);
    expect(eurosToCents('1.50')).toBe(150);
    expect(eurosToCents(1.5)).toBe(150);
    expect(eurosToCents('0')).toBe(0);
  });

  it('rejects sub-cent precision and garbage', () => {
    expect(() => eurosToCents('1,505')).toThrow(MoneyError);
    expect(() => eurosToCents('abc')).toThrow(MoneyError);
  });
});

describe('changeRatio', () => {
  it('computes the variation against the base price', () => {
    expect(changeRatio(110, 100)).toBeCloseTo(0.1);
    expect(changeRatio(90, 100)).toBeCloseTo(-0.1);
  });

  it('rejects a zero base', () => {
    expect(() => changeRatio(110, 0)).toThrow(MoneyError);
  });
});
