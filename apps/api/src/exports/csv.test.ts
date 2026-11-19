import { describe, expect, it } from 'vitest';
import { CsvWriter, cell, decimalOf, guardFormula, row, stripFormulaGuard } from './csv.js';

describe('CSV cells (M2-REG-02)', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])(
    'prefixes a text cell that starts with a formula character: %j',
    (value) => {
      expect(guardFormula(value)).toBe(`'${value}`);
      // the importer's inverse restores exactly the original
      expect(stripFormulaGuard(guardFormula(value))).toBe(value);
    },
  );

  it('leaves ordinary text alone and strips only the guard apostrophe it added', () => {
    expect(guardFormula('Laptop')).toBe('Laptop');
    expect(guardFormula("it's")).toBe("it's");
    expect(stripFormulaGuard("'hello")).toBe("'hello"); // an apostrophe that was not a guard
    expect(stripFormulaGuard("'=1+1")).toBe('=1+1');
  });

  it('writes numbers as numbers (never guarded), empties for null and undefined', () => {
    expect(cell(-5)).toBe('-5');
    expect(cell(12.5)).toBe('12.5');
    expect(cell(null)).toBe('');
    expect(cell(undefined)).toBe('');
    expect(cell(true)).toBe('true');
    expect(cell(Number.NaN)).toBe('');
  });

  it('quotes cells with commas, quotes and line breaks, and doubles the quotes', () => {
    expect(cell('a,b')).toBe('"a,b"');
    expect(cell('say "hi"')).toBe('"say ""hi"""');
    expect(cell('two\nlines')).toBe('"two\nlines"');
    expect(cell(' padded ')).toBe('" padded "');
    // a guarded cell that also needs quoting
    expect(cell('=A1,B1')).toBe('"\'=A1,B1"');
  });

  it('drops control characters but keeps tabs inside text', () => {
    expect(cell('a\u0000b\u0007c')).toBe('abc');
    expect(cell('a\tb')).toBe('a\tb');
  });

  it('builds a row', () => {
    expect(row(['a', 'b,c', 1, null])).toBe('a,"b,c",1,');
  });
});

describe('CsvWriter', () => {
  it('starts with a byte order mark and the header, ends every row with CRLF', () => {
    const csv = new CsvWriter(['tag', 'name']);
    csv.add(['A-1', '=cmd|calc']);
    csv.add(['A-2', 'Ünï "cødé"']);
    const text = csv.toBuffer().toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe(`tag,name\r\nA-1,'=cmd|calc\r\nA-2,"Ünï ""cødé"""\r\n`);
    expect(csv.rows).toBe(2);
    expect(csv.size).toBe(csv.toBuffer().length);
  });
});

describe('decimalOf', () => {
  it("uses the currency's own number of decimals", () => {
    expect(decimalOf(12345, 'EUR')).toBe('123.45');
    expect(decimalOf(5, 'USD')).toBe('0.05');
    expect(decimalOf(1200, 'JPY')).toBe('1200');
    expect(decimalOf(1234567, 'KWD')).toBe('1234.567');
    expect(decimalOf(0, 'EUR')).toBe('0.00');
  });
});
