import { describe, expect, it } from 'vitest';
import {
  assertNoForbiddenPriceWords,
  canPurchaseAlcohol,
  findForbiddenPriceWords,
  normalizeText,
  remainingAlcoholAllowance,
} from './compliance';

describe('findForbiddenPriceWords (L3)', () => {
  it('detects accented and capitalised forms', () => {
    expect(findForbiddenPriceWords('Promoção de fim de noite')).toContain('promocao');
    expect(findForbiddenPriceWords('DESCONTO especial')).toContain('desconto');
    expect(findForbiddenPriceWords('saldos')).toContain('saldos');
  });

  it('detects discount percentages', () => {
    expect(findForbiddenPriceWords('agora -20%')).toContain('percentagem de desconto');
  });

  it('accepts the compliant vocabulary', () => {
    expect(findForbiddenPriceWords('Cotação atual: 1,50 €')).toEqual([]);
    expect(findForbiddenPriceWords('Variação +8% face ao preço base')).toEqual([]);
    expect(findForbiddenPriceWords('Queda de mercado')).toEqual([]);
  });

  it('does not flag words that merely contain a forbidden substring', () => {
    expect(findForbiddenPriceWords('ofertante')).toEqual([]);
  });

  it('throws with a useful message when asserting', () => {
    expect(() => assertNoForbiddenPriceWords('grande promoção', 'market copy')).toThrow(
      /market copy violates L3/,
    );
    expect(() => assertNoForbiddenPriceWords('cotação')).not.toThrow();
  });
});

describe('normalizeText', () => {
  it('strips accents and lowercases', () => {
    expect(normalizeText('Cotação ÚNICA')).toBe('cotacao unica');
  });
});

describe('alcohol rules', () => {
  it('requires the 18+ declaration (L5)', () => {
    expect(canPurchaseAlcohol({ isAdultDeclared: true })).toBe(true);
    expect(canPurchaseAlcohol({ isAdultDeclared: false })).toBe(false);
  });

  it('computes the remaining allowance in the window (L8)', () => {
    expect(remainingAlcoholAllowance(0, 4)).toBe(4);
    expect(remainingAlcoholAllowance(3, 4)).toBe(1);
    expect(remainingAlcoholAllowance(6, 4)).toBe(0);
  });
});
