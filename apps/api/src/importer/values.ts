import { stripFormulaGuard } from '../exports/index.js';

/**
 * Parsing of the text cells of an import into typed values (M2-IMP-03): dates, numbers, money, booleans
 * and text. Pure functions; every failure carries a message the user can act on. A spreadsheet cell is
 * always text here (the XLSX reader already turned typed dates into ISO text).
 */

export type DateFormat = 'auto' | 'iso' | 'dmy' | 'mdy';
export const DATE_FORMATS: readonly DateFormat[] = ['auto', 'iso', 'dmy', 'mdy'];
/** The decimal separator of numbers in the file; `auto` decides per value where it is unambiguous. */
export type NumberFormat = 'auto' | 'dot' | 'comma';
export const NUMBER_FORMATS: readonly NumberFormat[] = ['auto', 'dot', 'comma'];

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string; code: string };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (message: string, code = 'invalid'): Parsed<never> => ({ ok: false, message, code });

/** A cell as text: trimmed, with the export formula guard removed (`'=1+1` -> `=1+1`). */
export function cellText(raw: string | undefined | null): string {
  if (raw === undefined || raw === null) return '';
  return stripFormulaGuard(raw.replace(/\u00a0/g, ' ').trim()).trim();
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function isRealDate(y: number, m: number, d: number): boolean {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 100) date.setUTCFullYear(y);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
const iso = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Two-digit years: 00-69 are 2000-2069, 70-99 are 1970-1999. */
const fullYear = (y: number, digits: number): number =>
  digits <= 2 ? (y < 70 ? 2000 + y : 1900 + y) : y;

/** The day-first / month-first order of a `a/b/yyyy` date, or `ambiguous` when both parts fit a month. */
export function slashOrder(a: number, b: number): 'dmy' | 'mdy' | 'ambiguous' | 'invalid' {
  if (a > 12 && b <= 12) return 'dmy';
  if (b > 12 && a <= 12) return 'mdy';
  if (a > 12 && b > 12) return 'invalid';
  return a === b ? 'dmy' : 'ambiguous';
}

/** A date as `YYYY-MM-DD`. ISO dates and month names always parse; `a/b/y` follows `format`. */
export function parseDate(text: string, format: DateFormat = 'auto'): Parsed<string> {
  const t = cellText(text);
  let m: RegExpExecArray | null;
  // 2024-03-07, 2024-03-07T10:00:00Z, 2024/03/07, 2024.03.07
  if (
    (m =
      /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(
        t,
      ))
  ) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isRealDate(y, mo, d)
      ? ok(iso(y, mo, d))
      : fail(`"${t}" is not a real calendar date`, 'date');
  }
  // 7 Mar 2024, 07-Mar-24, March 7, 2024, Mar 7 2024
  if ((m = /^(\d{1,2})[ \-./]([A-Za-z]{3,9})\.?,?[ \-./](\d{2,4})$/.exec(t))) {
    const mo = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1;
    const y = fullYear(Number(m[3]), m[3]!.length);
    return mo > 0 && isRealDate(y, mo, Number(m[1]))
      ? ok(iso(y, mo, Number(m[1])))
      : fail(`"${t}" is not a real calendar date`, 'date');
  }
  if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(t))) {
    const mo = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1;
    return mo > 0 && isRealDate(Number(m[3]), mo, Number(m[2]))
      ? ok(iso(Number(m[3]), mo, Number(m[2])))
      : fail(`"${t}" is not a real calendar date`, 'date');
  }
  // 07/03/2024, 7.3.24, 03-07-2024 : day-first or month-first
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fullYear(Number(m[3]), m[3]!.length);
    let order: 'dmy' | 'mdy';
    if (format === 'dmy' || format === 'mdy') order = format;
    else {
      const guess = slashOrder(a, b);
      if (guess === 'ambiguous') {
        return fail(
          `"${t}" can be read as day/month or month/day: choose the date format of the file (day first or month first)`,
          'ambiguous-date',
        );
      }
      if (guess === 'invalid') return fail(`"${t}" is not a real calendar date`, 'date');
      order = guess;
    }
    const [d, mo] = order === 'dmy' ? [a, b] : [b, a];
    return isRealDate(y, mo, d)
      ? ok(iso(y, mo, d))
      : fail(`"${t}" is not a real calendar date`, 'date');
  }
  // 20240307
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(t))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (isRealDate(y, mo, d)) return ok(iso(y, mo, d));
  }
  return fail(
    `"${t.slice(0, 60)}" is not a date (use 2024-03-07, 7 Mar 2024 or day/month/year)`,
    'date',
  );
}

/** A number; the decimal separator follows `format` (`auto` decides where the text is unambiguous). */
export function parseNumber(text: string, format: NumberFormat = 'auto'): Parsed<number> {
  let t = cellText(text);
  if (t === '') return fail('is empty', 'required');
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  // currency symbols, codes, spaces and apostrophe separators around the number
  t = t
    .replace(/\p{Sc}/gu, '')
    .replace(/^[A-Za-z]{3}(?=[\s\d-])/, '')
    .replace(/(?<=[\d\s])[A-Za-z]{3}$/, '')
    .replace(/[\s']/g, '');
  if (t.startsWith('-')) {
    negative = !negative;
    t = t.slice(1);
  } else if (t.startsWith('+')) t = t.slice(1);
  if (t.endsWith('-')) {
    negative = !negative;
    t = t.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t))
    return fail(`"${text.trim().slice(0, 40)}" is not a number`, 'number');
  const dots = (t.match(/\./g) ?? []).length;
  const commas = (t.match(/,/g) ?? []).length;
  let decimal: '.' | ',' | null;
  if (format === 'dot') decimal = '.';
  else if (format === 'comma') decimal = ',';
  else if (dots > 0 && commas > 0) decimal = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
  else if (dots > 1)
    decimal = null; // 1.234.567: thousands
  else if (commas > 1)
    decimal = null; // 1,234,567: thousands
  else if (dots === 1)
    decimal = /^\d{1,3}\.\d{3}$/.test(t) ? null : '.'; // 1.234: thousands, 1.2 and 1.23 decimals
  else if (commas === 1)
    decimal = /^\d{1,3},\d{3}$/.test(t) ? null : ','; // 1,234: thousands
  else decimal = null;
  let normal: string;
  if (decimal === null) normal = t.replace(/[.,]/g, '');
  else {
    const thousands = decimal === '.' ? ',' : '.';
    const parts = t.split(decimal);
    if (parts.length > 2) return fail(`"${text.trim().slice(0, 40)}" is not a number`, 'number');
    const intPart = parts[0]!.split(thousands).join('');
    normal = parts.length === 2 ? `${intPart}.${parts[1]!.split(thousands).join('')}` : intPart;
  }
  if (!/^\d*\.?\d+$|^\d+\.?$/.test(normal))
    return fail(`"${text.trim().slice(0, 40)}" is not a number`, 'number');
  const n = Number(normal);
  if (!Number.isFinite(n)) return fail(`"${text.trim().slice(0, 40)}" is not a number`, 'number');
  return ok(negative ? -n : n);
}

/** Decimals of a currency's minor unit (`JPY` 0, `EUR` 2, `KWD` 3). */
export function minorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** The ISO 4217 code a money cell names (`€`, `USD 12`, `12 EUR`), or null. */
export function currencyHint(text: string): string | null {
  const t = text.trim();
  const code = /(?:^|[^A-Za-z])([A-Z]{3})(?:[^A-Za-z]|$)/.exec(t);
  if (code && /\d/.test(t)) return code[1]!;
  if (t.includes('€')) return 'EUR';
  if (t.includes('£')) return 'GBP';
  if (t.includes('¥')) return 'JPY';
  return null;
}

/** An amount in minor units: `12.5` EUR is 1250. Negative amounts are refused (a cost is never negative). */
export function toMinor(amount: number, currency: string): Parsed<number> {
  if (amount < 0) return fail('must not be negative', 'negative');
  // toPrecision first: 1.005 * 100 is 100.49999999999999 in binary floating point
  const minor = Math.round(Number((amount * 10 ** minorDigits(currency)).toPrecision(15)));
  return Number.isSafeInteger(minor) ? ok(minor) : fail('is too large', 'too_big');
}

const TRUE = new Set(['true', 'yes', 'y', '1', 'on', 'x', 'ja', 'oui', 'si']);
const FALSE = new Set(['false', 'no', 'n', '0', 'off', 'nein', 'non']);

export function parseBoolean(text: string): Parsed<boolean> {
  const t = cellText(text).toLowerCase();
  if (TRUE.has(t)) return ok(true);
  if (FALSE.has(t)) return ok(false);
  return fail(`"${text.trim().slice(0, 30)}" is not yes/no or true/false`, 'boolean');
}

/** Normalised key used to compare names, tags, serials and emails across the file and the registry. */
export function normKey(text: string | null | undefined): string {
  return (text ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A header or value reduced to letters and digits: `Serial No.` and `serial_no` are the same. */
export function looseKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
