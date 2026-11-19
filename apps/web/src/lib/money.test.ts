import { describe, expect, it } from 'vitest';
import { minorDigits, moneyInputValue, moneyMajor, parseMoney, sumMoney } from './money';

describe('money', () => {
  it('knows the decimals of a currency', () => {
    expect(minorDigits('USD')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
    expect(minorDigits('???')).toBe(2);
  });

  it('parses typed amounts into minor units without floating point error', () => {
    expect(parseMoney('64', 'USD')).toEqual({ amount_minor: 6400, currency: 'USD' });
    expect(parseMoney('64.1', 'USD')).toEqual({ amount_minor: 6410, currency: 'USD' });
    expect(parseMoney(' 1,250.05 ', 'USD')).toEqual({ amount_minor: 125005, currency: 'USD' });
    expect(parseMoney('0.29', 'USD')).toEqual({ amount_minor: 29, currency: 'USD' });
    expect(parseMoney('1.15', 'USD')?.valueOf()).toEqual({ amount_minor: 115, currency: 'USD' });
    expect(parseMoney('500', 'JPY')).toEqual({ amount_minor: 500, currency: 'JPY' });
  });

  it('treats an empty field as no amount and anything odd as invalid', () => {
    expect(parseMoney('', 'USD')).toBeNull();
    expect(parseMoney('   ', 'USD')).toBeNull();
    for (const bad of ['abc', '-5', '1.234', '1e3', '12.5.1', '1,2,3.4x', '99999999999999']) {
      expect(parseMoney(bad, 'USD')).toBe('invalid');
    }
    expect(parseMoney('10.5', 'JPY')).toBe('invalid');
  });

  it('formats for a field and for Intl', () => {
    expect(moneyInputValue({ amount_minor: 6400, currency: 'USD' })).toBe('64.00');
    expect(moneyInputValue({ amount_minor: 500, currency: 'JPY' })).toBe('500');
    expect(moneyInputValue(null)).toBe('');
    expect(moneyMajor({ amount_minor: 6410, currency: 'USD' })).toBe(64.1);
  });

  it('adds per currency and never across currencies', () => {
    expect(
      sumMoney([
        { amount_minor: 100, currency: 'USD' },
        null,
        { amount_minor: 250, currency: 'EUR' },
        { amount_minor: 50, currency: 'USD' },
        undefined,
      ]),
    ).toEqual([
      { amount_minor: 150, currency: 'USD' },
      { amount_minor: 250, currency: 'EUR' },
    ]);
    expect(sumMoney([])).toEqual([]);
  });
});
