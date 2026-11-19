/**
 * CSV for exports (M2-REG-02): RFC 4180 (CRLF, quotes doubled), UTF-8 with a byte order mark (Excel
 * opens it with the right encoding), and safe against spreadsheet formula injection (OWASP "CSV
 * injection"): a TEXT cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return gets a
 * leading apostrophe, which every spreadsheet shows as plain text. Numbers are written as numbers and
 * are never prefixed (a number cannot be a formula). The importer strips that single apostrophe again
 * (`stripFormulaGuard`), so an export re-imports to the same values.
 */
export type Cell = string | number | boolean | null | undefined;

const BOM = '﻿';
const FORMULA_START = /^[=+\-@\t\r]/;

/** Neutralises a text cell that a spreadsheet could take for a formula. */
export function guardFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** The inverse, for the importer: removes the one apostrophe `guardFormula` added. */
export function stripFormulaGuard(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

function stripControl(value: string): string {
  let out = '';
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x08 || c === 0x0b || c === 0x0c || (c >= 0x0e && c <= 0x1f)) continue;
    out += ch;
  }
  return out;
}

/** One cell as CSV text. */
export function cell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  // NUL cannot be stored by PostgreSQL text anyway; other control characters (except tab, handled by
  // the guard, and the line breaks that are quoted below) are dropped.
  const text = guardFormula(stripControl(value));
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function row(values: readonly Cell[]): string {
  return values.map(cell).join(',');
}

/** Accumulates a CSV document in memory chunks (the storage port takes a buffer). */
export class CsvWriter {
  private readonly chunks: string[] = [];
  private bytes = 0;
  rows = 0;

  constructor(header: readonly string[]) {
    this.push(BOM + row(header) + '\r\n');
  }

  add(values: readonly Cell[]): void {
    this.push(row(values) + '\r\n');
    this.rows += 1;
  }

  get size(): number {
    return this.bytes;
  }

  toBuffer(): Buffer {
    return Buffer.from(this.chunks.join(''), 'utf8');
  }

  private push(text: string): void {
    this.chunks.push(text);
    this.bytes += Buffer.byteLength(text);
  }
}

/** Minor units as a plain decimal in the currency's own number of decimals (`12345`, EUR -> `123.45`). */
export function decimalOf(amountMinor: number, currency: string): string {
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    // unknown code: the contract only checks the three-letter shape
  }
  if (digits === 0) return String(amountMinor);
  const s = String(amountMinor).padStart(digits + 1, '0');
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}
