import type { Readable } from 'node:stream';
import {
  type CsvEncoding,
  CSV_DELIMITERS,
  FileFormatError,
  type RawRow,
  csvRows,
  detectEncoding,
  samplePrefix,
  sniffDelimiter,
} from './csv-reader.js';
import { XlsxWorkbook } from './xlsx-reader.js';
import { looseKey, slashOrder } from './values.js';

/** What the analysis found (or the user overrode) about how to read the file. Stored as `import_job.parse`. */
export interface ParseSettings {
  format: 'csv' | 'xlsx';
  encoding?: CsvEncoding;
  delimiter?: string;
  sheet?: string | null;
  /** Row (XLSX) or line (CSV) number of the header row; null = detected. */
  header_line?: number | null;
}

/** Opens the file as a byte stream (the storage adapter's `read`). */
export type OpenFile = () => Promise<Readable>;

export function formatOf(filename: string): 'csv' | 'xlsx' {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) return 'csv';
  if (lower.endsWith('.xls')) {
    throw new FileFormatError(
      'Old Excel files (.xls) are not supported. Save the file as .xlsx or export it as CSV.',
    );
  }
  throw new FileFormatError(
    'Only .csv, .tsv or .txt (comma- or tab-separated text) and .xlsx files can be imported.',
  );
}

/** Fills in what the file itself says: the encoding and delimiter of a CSV, the sheet of a workbook. */
export async function detectParse(
  open: OpenFile,
  filename: string,
  overrides: Partial<ParseSettings> = {},
): Promise<ParseSettings & { sheets?: string[] }> {
  const format = formatOf(filename);
  if (format === 'xlsx') {
    const book = await XlsxWorkbook.open(await open());
    try {
      const sheet = book.pick(overrides.sheet);
      return {
        format,
        sheet: sheet.name,
        header_line: overrides.header_line ?? null,
        sheets: book.sheets.filter((s) => !s.hidden).map((s) => s.name),
      };
    } finally {
      await book.close();
    }
  }
  const encoding = overrides.encoding ?? (await detectEncoding(await open()));
  let delimiter = overrides.delimiter;
  if (!delimiter) {
    const stream = await open();
    try {
      delimiter = sniffDelimiter(await samplePrefix(stream, encoding));
    } finally {
      stream.destroy();
    }
  }
  if (!CSV_DELIMITERS.includes(delimiter as (typeof CSV_DELIMITERS)[number])) {
    throw new FileFormatError('The delimiter must be a comma, semicolon, tab or pipe.');
  }
  return { format, encoding, delimiter, header_line: overrides.header_line ?? null };
}

/** All non-empty rows of the file as the settings say, streamed. */
export async function* readRows(open: OpenFile, parse: ParseSettings): AsyncGenerator<RawRow> {
  if (parse.format === 'xlsx') {
    const book = await XlsxWorkbook.open(await open());
    try {
      yield* book.rows(book.pick(parse.sheet));
    } finally {
      await book.close();
    }
    return;
  }
  const stream = await open();
  try {
    yield* csvRows(stream, parse.encoding ?? 'utf-8', parse.delimiter ?? ',');
  } finally {
    stream.destroy();
  }
}

// -------------------------------------------------------------------------------- header detection

const filled = (cells: string[]): number => cells.filter((c) => c.trim() !== '').length;

/**
 * Index (into `head`, the first rows of the file) of the header row: the row the user named, else the
 * first row that has at least half as many filled cells as the widest of the first ten rows (a title
 * line above the table has one) and mostly non-numeric, distinct text.
 */
export function detectHeaderIndex(head: RawRow[], headerLine?: number | null): number {
  if (headerLine) {
    const named = head.findIndex((r) => r.line === headerLine);
    if (named < 0) {
      throw new FileFormatError(
        `Row ${headerLine} is not in the file's first rows (or it is empty), so it cannot be the header row.`,
        headerLine,
      );
    }
    return named;
  }
  const widest = Math.max(1, ...head.slice(0, 10).map((r) => filled(r.cells)));
  for (let i = 0; i < head.length; i++) {
    const cells = head[i]!.cells.map((c) => c.trim()).filter(Boolean);
    if (cells.length < Math.min(2, widest) || cells.length * 2 < widest) continue;
    const texty = cells.filter((c) => !/^[-+\d.,\s%$€£]+$/.test(c)).length;
    if (texty * 10 >= cells.length * 7) return i;
  }
  return 0;
}

/** Display names of the columns: trimmed, blank ones named `Column C`, duplicates suffixed `(2)`. */
export function headerNames(cells: string[]): string[] {
  const seen = new Map<string, number>();
  return cells.map((c, i) => {
    let name = c.replace(/\s+/g, ' ').trim();
    if (name === '') name = `Column ${columnLetters(i)}`;
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? name : `${name} (${n})`;
  });
}

export function columnLetters(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// ------------------------------------------------------------------------------------- profiling

export type DetectedType = 'empty' | 'integer' | 'number' | 'date' | 'boolean' | 'email' | 'text';

export interface ColumnProfile {
  index: number;
  header: string;
  non_blank: number;
  blank: number;
  distinct: number;
  /** True when more than 10,000 distinct values were seen and `distinct` is a lower bound. */
  distinct_capped: boolean;
  /** Non-blank cells that repeat an earlier value (0 when `distinct_capped`). */
  duplicates: number;
  type: DetectedType;
  /** For `date` columns written with slashes: which order the data allows. */
  date_order: 'iso' | 'dmy' | 'mdy' | 'ambiguous' | 'mixed' | null;
  max_length: number;
  samples: string[];
}

const DISTINCT_CAP = 10_000;

/** Accumulates the statistics of the data rows, one row at a time (constant memory per column). */
export class Profiler {
  private readonly cols: Array<{
    non_blank: number;
    seen: Set<string>;
    capped: boolean;
    dup: number;
    types: Record<string, number>;
    order: Record<string, number>;
    maxLen: number;
    samples: string[];
  }>;

  constructor(readonly headers: string[]) {
    this.cols = headers.map(() => ({
      non_blank: 0,
      seen: new Set(),
      capped: false,
      dup: 0,
      types: {},
      order: {},
      maxLen: 0,
      samples: [],
    }));
  }

  add(cells: string[]): void {
    for (let i = 0; i < this.cols.length; i++) {
      const raw = cells[i];
      const v = raw === undefined ? '' : raw.trim();
      if (v === '') continue;
      const c = this.cols[i]!;
      c.non_blank++;
      if (v.length > c.maxLen) c.maxLen = v.length;
      if (!c.capped) {
        if (c.seen.has(v)) c.dup++;
        else if (c.seen.size >= DISTINCT_CAP) c.capped = true;
        else {
          c.seen.add(v);
          if (c.samples.length < 5) c.samples.push(v.length > 80 ? `${v.slice(0, 80)}…` : v);
        }
      }
      const kind = classify(v);
      c.types[kind.type] = (c.types[kind.type] ?? 0) + 1;
      if (kind.order) c.order[kind.order] = (c.order[kind.order] ?? 0) + 1;
    }
  }

  result(rows: number): ColumnProfile[] {
    return this.cols.map((c, index) => {
      let type: DetectedType = 'empty';
      if (c.non_blank > 0) {
        type = 'text';
        const [top, n] = Object.entries(c.types).sort((a, b) => b[1] - a[1])[0]!;
        // integers are numbers too: a column of 1, 2, 3.5 is a number column
        const numeric = (c.types.integer ?? 0) + (c.types.number ?? 0);
        if (numeric >= c.non_blank * 0.95) type = (c.types.number ?? 0) > 0 ? 'number' : 'integer';
        else if (n >= c.non_blank * 0.95) type = top as DetectedType;
      }
      let dateOrder: ColumnProfile['date_order'] = null;
      if (type === 'date') {
        const orders = Object.keys(c.order);
        if (orders.length === 0) dateOrder = 'iso';
        else if (orders.includes('dmy') && orders.includes('mdy')) dateOrder = 'mixed';
        else if (orders.includes('dmy')) dateOrder = 'dmy';
        else if (orders.includes('mdy')) dateOrder = 'mdy';
        else dateOrder = orders.includes('ambiguous') ? 'ambiguous' : 'iso';
      }
      return {
        index,
        header: this.headers[index]!,
        non_blank: c.non_blank,
        blank: rows - c.non_blank,
        distinct: c.seen.size,
        distinct_capped: c.capped,
        duplicates: c.capped ? 0 : c.dup,
        type,
        date_order: dateOrder,
        max_length: c.maxLen,
        samples: c.samples,
      };
    });
  }
}

function classify(v: string): { type: DetectedType; order?: 'dmy' | 'mdy' | 'ambiguous' } {
  if (/^[-+]?\d+$/.test(v) && v.length < 16)
    return { type: /^[-+]?0\d/.test(v) ? 'text' : 'integer' };
  if (/^[-+]?(\d{1,3}([.,]\d{3})+|\d+)([.,]\d+)?$/.test(v)) return { type: 'number' };
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}([T ].*)?$/.test(v)) return { type: 'date' };
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(v);
  if (slash) {
    const order = slashOrder(Number(slash[1]), Number(slash[2]));
    return { type: 'date', ...(order === 'invalid' ? {} : { order }) };
  }
  if (/^\d{1,2}[ -][A-Za-z]{3,9}\.?[ ,-]+\d{2,4}$/.test(v)) return { type: 'date' };
  if (/^(true|false|yes|no)$/i.test(v)) return { type: 'boolean' };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { type: 'email' };
  return { type: 'text' };
}

export { looseKey };
