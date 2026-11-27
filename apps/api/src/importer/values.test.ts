import { describe, expect, it } from 'vitest';
import { guardFormula } from '../exports/index.js';
import {
  cellText,
  currencyHint,
  normKey,
  parseBoolean,
  parseDate,
  parseNumber,
  toMinor,
} from './values.js';

const value = <T>(r: { ok: boolean; value?: T }): T | undefined => (r.ok ? r.value : undefined);

describe('dates (M2-IMP-03)', () => {
  it('parses ISO dates, ISO datetimes and month names', () => {
    expect(value(parseDate('2024-03-07'))).toBe('2024-03-07');
    expect(value(parseDate('2024-03-07T10:22:00.000Z'))).toBe('2024-03-07');
    expect(value(parseDate('7 Mar 2024'))).toBe('2024-03-07');
    expect(value(parseDate('March 7, 2024'))).toBe('2024-03-07');
    expect(value(parseDate('07-Mar-24'))).toBe('2024-03-07');
    expect(value(parseDate('20240307'))).toBe('2024-03-07');
  });

  it('needs an explicit order for ambiguous dates, and honours it', () => {
    const amb = parseDate('03/04/2024');
    expect(amb).toMatchObject({ ok: false, code: 'ambiguous-date' });
    expect(value(parseDate('03/04/2024', 'dmy'))).toBe('2024-04-03');
    expect(value(parseDate('03/04/2024', 'mdy'))).toBe('2024-03-04');
  });

  it('reads unambiguous slash dates without a format and refuses impossible ones', () => {
    expect(value(parseDate('25/12/2024'))).toBe('2024-12-25');
    expect(value(parseDate('12/25/2024'))).toBe('2024-12-25');
    expect(value(parseDate('31.12.24'))).toBe('2024-12-31');
    expect(parseDate('2024-02-30')).toMatchObject({ ok: false });
    expect(parseDate('not a date')).toMatchObject({ ok: false, code: 'date' });
    expect(parseDate('13/13/2024')).toMatchObject({ ok: false });
  });
});

describe('numbers and money', () => {
  it('reads US, European and ambiguous formats', () => {
    expect(value(parseNumber('1,234.50'))).toBe(1234.5);
    expect(value(parseNumber('1.234,50'))).toBe(1234.5);
    expect(value(parseNumber('1 234,5'))).toBe(1234.5);
    expect(value(parseNumber('1,234,567'))).toBe(1234567);
    expect(value(parseNumber('1.234.567'))).toBe(1234567);
    expect(value(parseNumber('12,5'))).toBe(12.5);
    expect(value(parseNumber('12.5'))).toBe(12.5);
    expect(value(parseNumber('(1,000.00)'))).toBe(-1000);
    expect(value(parseNumber('$ 1,299.99'))).toBe(1299.99);
    expect(value(parseNumber('EUR 12,50'))).toBe(12.5);
    expect(value(parseNumber('12.50 EUR'))).toBe(12.5);
  });

  it('lets the tenant choose the decimal separator for the ambiguous "1,234"', () => {
    expect(value(parseNumber('1,234'))).toBe(1234);
    expect(value(parseNumber('1,234', 'comma'))).toBe(1.234);
    expect(value(parseNumber('1.234', 'comma'))).toBe(1234);
    expect(value(parseNumber('1.234', 'dot'))).toBe(1.234);
  });

  it('rejects text', () => {
    expect(parseNumber('abc')).toMatchObject({ ok: false, code: 'number' });
    expect(parseNumber('')).toMatchObject({ ok: false });
    expect(parseNumber('1,2,3x')).toMatchObject({ ok: false });
  });

  it('converts to minor units per currency and finds a currency in the cell', () => {
    expect(value(toMinor(12.5, 'EUR'))).toBe(1250);
    expect(value(toMinor(1250, 'JPY'))).toBe(1250);
    expect(value(toMinor(1.005, 'USD'))).toBe(101);
    expect(toMinor(-1, 'USD')).toMatchObject({ ok: false });
    expect(currencyHint('€12,50')).toBe('EUR');
    expect(currencyHint('USD 12.50')).toBe('USD');
    expect(currencyHint('12.50')).toBeNull();
  });

  it('reads rupee amounts as Indian registers write them: Rs, Rs., INR, ₹ and a trailing "/-"', () => {
    for (const [text, n] of [
      ['Rs.44000/-', 44000],
      ['Rs 44,000/-', 44000],
      ['Rs. 44,000 /-', 44000],
      ['rs.44000', 44000],
      ['INR 44000', 44000],
      ['INR. 44,000.50', 44000.5],
      ['₹44,000/-', 44000],
      ['₹ 58,000', 58000],
      ['44000/-', 44000],
      ['44000/=', 44000],
      ['44000 Rs', 44000],
      ['Rs.1,14,900.00/-', 114900],
      ['1,14,900.00', 114900],
      ['Rs. 12,34,567', 1234567],
      ['$44,000/-', 44000],
      ['€1.234,50', 1234.5],
      ['£ 1,299.99', 1299.99],
    ] as const) {
      expect(value(parseNumber(text)), text).toBe(n);
    }
    // a trailing minus is still a negative number, and words are still not numbers
    expect(value(parseNumber('44000-'))).toBe(-44000);
    for (const text of ['Rs.', 'Rs. donated', 'not known', '/-', 'Rsx44000']) {
      expect(parseNumber(text), text).toMatchObject({ ok: false });
    }
  });

  it('a rupee amount names its currency: ₹ and INR are INR, "Rs" the import\'s rupee or INR', () => {
    expect(currencyHint('₹ 58,000')).toBe('INR');
    expect(currencyHint('INR 44000')).toBe('INR');
    expect(currencyHint('Rs.44000/-')).toBe('INR');
    expect(currencyHint('Rs 44,000/-', 'USD')).toBe('INR');
    expect(currencyHint('Rs 44,000/-', 'LKR')).toBe('LKR');
    expect(currencyHint('44000 Rs', 'PKR')).toBe('PKR');
    expect(currencyHint('44000/-')).toBeNull();
    expect(currencyHint('Rsx 1')).toBeNull();
  });
});

describe('text helpers', () => {
  it('reads booleans', () => {
    expect(value(parseBoolean('Yes'))).toBe(true);
    expect(value(parseBoolean('0'))).toBe(false);
    expect(parseBoolean('maybe')).toMatchObject({ ok: false });
  });

  it('removes the export formula guard (the round trip of M2-REG-02) and non-breaking spaces', () => {
    for (const original of ['=1+1', '+49 170 1234567', '-5 items', '@home', '\tindented']) {
      expect(cellText(guardFormula(original))).toBe(original.trim());
    }
    expect(cellText("'quoted text")).toBe("'quoted text");
    expect(cellText('  a b  ')).toBe('a b');
    expect(normKey('  Ready  To   Deploy ')).toBe('ready to deploy');
  });
});
