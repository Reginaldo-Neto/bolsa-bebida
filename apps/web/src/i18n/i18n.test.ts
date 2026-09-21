// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { en, pt, translate } from './index';

const ptKeys = Object.keys(pt) as (keyof typeof pt)[];

function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string).sort();
}

/**
 * TypeScript already refuses an English dictionary with a missing key. What it
 * cannot see is a translation that drops a `{placeholder}`, which renders the
 * brace literally next to a price — so that is what these check.
 */
describe('translation dictionaries', () => {
  it('covers the whole interface', () => {
    expect(ptKeys.length).toBeGreaterThan(100);
  });

  it('has no extra English keys', () => {
    expect(Object.keys(en).sort()).toEqual([...ptKeys].sort());
  });

  it.each(ptKeys)('%s carries the same placeholders in both languages', (key) => {
    expect(placeholdersOf(en[key])).toEqual(placeholdersOf(pt[key]));
  });

  it.each(ptKeys)('%s is not empty in either language', (key) => {
    expect(pt[key].length).toBeGreaterThan(0);
    expect(en[key].length).toBeGreaterThan(0);
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(translate('pt-PT', 'cart.each', { price: '1,50 €' })).toBe('1,50 € cada');
    expect(translate('en', 'cart.each', { price: '€1.50' })).toContain('€1.50');
    expect(translate('pt-PT', 'cart.each', {})).toBe('{price} cada');
  });
});
