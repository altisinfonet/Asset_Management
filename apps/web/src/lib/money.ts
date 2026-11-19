import type { components } from '@assettracker/api-client';

/**
 * Money as the contract has it: integer minor units and an ISO 4217 currency (`Money`). Parsing is
 * strict: a typed amount becomes minor units without floating point, so `64.10` is `6410` and never
 * `6409.999...`.
 */
export type Money = components['schemas']['Money'];

/** Decimal places of a currency (2 for USD and EUR, 0 for JPY). */
export function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits!;
  } catch {
    return 2;
  }
}

/**
 * Parse an amount typed by a person ("64", "64.5", "1,250.00"). Returns `null` for an empty
 * field and `'invalid'` for anything that is not a non-negative amount with at most the
 * currency's decimals.
 */
export function parseMoney(input: string, currency: string): Money | null | 'invalid' {
  const text = input.trim().replace(/[\s,]/g, '');
  if (!text) return null;
  const digits = minorDigits(currency);
  const match = /^(\d{1,12})(?:\.(\d*))?$/.exec(text);
  if (!match) return 'invalid';
  const fraction = match[2] ?? '';
  if (fraction.length > digits) return 'invalid';
  const whole = Number(match[1]);
  const minor = Number(fraction.padEnd(digits, '0') || '0');
  const amount = whole * 10 ** digits + minor;
  if (!Number.isSafeInteger(amount)) return 'invalid';
  return { amount_minor: amount, currency };
}

/** The editable text of an amount ("64.00"), for a field that is being edited. */
export function moneyInputValue(money: Money | null | undefined): string {
  if (!money) return '';
  const digits = minorDigits(money.currency);
  return (money.amount_minor / 10 ** digits).toFixed(digits);
}

/** Major units as a number, for `Intl` formatting. */
export function moneyMajor(money: Money): number {
  return money.amount_minor / 10 ** minorDigits(money.currency);
}

/** Totals per currency, in first-seen order (amounts of different currencies are never added). */
export function sumMoney(values: ReadonlyArray<Money | null | undefined>): Money[] {
  const totals = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    totals.set(value.currency, (totals.get(value.currency) ?? 0) + value.amount_minor);
  }
  return [...totals].map(([currency, amount_minor]) => ({ amount_minor, currency }));
}
