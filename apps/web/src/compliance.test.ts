// @vitest-environment node
import { findForbiddenPriceWords } from '@bolsa/shared';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * L3 (DL 109-G/2021): the product may never announce price reductions.
 *
 * A code review can miss a "promoção" typed into a button at 2am; this cannot.
 * It reads every source file of the app and fails on the forbidden vocabulary,
 * pointing at the file that used it.
 */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx|css|html)$/.test(entry.name) && !entry.name.endsWith('.test.ts')
      ? [path]
      : [];
  });
}

const files = sourceFiles(join(__dirname));

describe('L3: price-reduction vocabulary', () => {
  it('scans the whole app, not a sample of it', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s says nothing about reductions', (file) => {
    const found = findForbiddenPriceWords(readFileSync(file, 'utf8'));
    expect(found, `${file} uses forbidden wording: ${found.join(', ')}`).toEqual([]);
  });

  it('would catch a violation if one were introduced', () => {
    // Guards the guard: if findForbiddenPriceWords ever stopped matching, every
    // test above would pass silently.
    expect(findForbiddenPriceWords('Grande promoção esta noite')).toContain('promocao');
    expect(findForbiddenPriceWords('cerveja com -30%')).toContain('percentagem de desconto');
  });
});
