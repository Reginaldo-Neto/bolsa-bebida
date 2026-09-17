import { FORBIDDEN_PRICE_WORDS } from '../constants';

/** Lowercases and strips accents so "Promoção" matches "promocao". */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/**
 * L3 (DL 109-G/2021): the product may never announce price reductions.
 * Returns every forbidden term found, so a test can point at the offending copy.
 */
export function findForbiddenPriceWords(text: string): string[] {
  const normalized = normalizeText(text);
  const found = new Set<string>();

  for (const word of FORBIDDEN_PRICE_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) {
      found.add(word);
    }
  }

  // Discount percentages are equally forbidden: "-20%", "20 % menos".
  if (/-\s*\d+([.,]\d+)?\s*%/.test(normalized)) {
    found.add('percentagem de desconto');
  }

  return [...found];
}

export function assertNoForbiddenPriceWords(text: string, label = 'text'): void {
  const found = findForbiddenPriceWords(text);
  if (found.length > 0) {
    throw new Error(`${label} violates L3 (DL 109-G/2021): ${found.join(', ')}`);
  }
}

/**
 * L5: alcohol may not be sold to under-18s. The declaration is made at join
 * time and re-checked by staff at pickup.
 */
export function canPurchaseAlcohol(participant: { isAdultDeclared: boolean }): boolean {
  return participant.isAdultDeclared;
}

/** L8: alcoholic units allowed in the remaining window. */
export function remainingAlcoholAllowance(unitsInWindow: number, limitPerWindow: number): number {
  return Math.max(0, limitPerWindow - unitsInWindow);
}
