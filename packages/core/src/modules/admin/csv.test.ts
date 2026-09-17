import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './reports.service';

describe('toCsv', () => {
  it('writes a header and rows', () => {
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('﻿a,b\r\n1,2\r\n');
  });

  it('quotes cells containing commas, quotes or newlines', () => {
    const csv = toCsv(['nome'], [['Gin, tonico'], ['Diz "ola"'], ['duas\nlinhas']]);

    expect(csv).toContain('"Gin, tonico"');
    expect(csv).toContain('"Diz ""ola"""');
    expect(csv).toContain('"duas\nlinhas"');
  });

  it('starts with a BOM, so Excel reads accents correctly', () => {
    expect(toCsv(['nome'], [['Água']]).startsWith('﻿')).toBe(true);
  });
});

describe('parseCsv', () => {
  it('reads plain rows', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads quoted fields, escaped quotes and embedded separators', () => {
    expect(parseCsv('nome,preco\r\n"Gin, tonico",450\r\n"Diz ""ola""",100')).toEqual([
      ['nome', 'preco'],
      ['Gin, tonico', '450'],
      ['Diz "ola"', '100'],
    ]);
  });

  it('handles a newline inside a quoted field', () => {
    expect(parseCsv('nome\r\n"duas\nlinhas"')).toEqual([['nome'], ['duas\nlinhas']]);
  });

  it('accepts LF as well as CRLF', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a leading BOM', () => {
    expect(parseCsv('﻿nome\r\nFino')).toEqual([['nome'], ['Fino']]);
  });

  it('round-trips whatever toCsv produced', () => {
    const rows = [
      ['Gin, tonico', 'Cocktails', '450'],
      ['Diz "ola"', 'Cerveja', '150'],
      ['Água', 'Sem alcool', '100'],
    ];
    const parsed = parseCsv(toCsv(['nome', 'grupo', 'preco'], rows));

    expect(parsed.slice(1)).toEqual(rows);
  });
});
