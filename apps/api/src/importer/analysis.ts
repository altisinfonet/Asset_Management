import type { Readable } from 'node:stream';
import { FileFormatError } from './csv-reader.js';
import { CUSTOM_PREFIX, type CustomTarget, type EntityType, suggestMapping } from './fields.js';
import {
  type ColumnProfile,
  type ParseSettings,
  Profiler,
  detectHeaderIndex,
  detectParse,
  headerNames,
  readRows,
} from './reader.js';
import type { Mapping } from './types.js';

/** What the analysis of a file produced; the engine stores it on the job and the rows in `import_row`. */
export interface Analysis {
  parse: ParseSettings & { sheets?: string[] };
  headers: string[];
  profile: ColumnProfile[];
  samples: string[][];
  rowsTotal: number;
  /** The heuristic mapping (editable by the user). */
  mapping: Mapping;
  confidence: Record<number, number>;
  /** 1-based line (CSV) or row (XLSX) of the header. */
  headerLine: number;
}

export interface AnalysisInput {
  open: () => Promise<Readable>;
  filename: string;
  overrides: Partial<ParseSettings>;
  entity: EntityType;
  custom: readonly CustomTarget[];
  maxRows: number;
  /** Receives the data rows in batches (row numbers are 1-based and contiguous). */
  sink: (rows: Array<{ row_no: number; line_no: number; raw: string[] }>) => Promise<void>;
  batch?: number;
}

/**
 * Reads a file once, as a stream: detects the format, encoding, delimiter and header row, profiles every
 * column, keeps 50 sample rows and hands all data rows to `sink` (which stores them). Never holds more
 * than a batch of rows. Throws {@link FileFormatError} (with the line number) for a malformed file, a
 * file without data and a file with more than `maxRows` rows.
 */
export async function analyseFile(input: AnalysisInput): Promise<Analysis> {
  const parse = await detectParse(input.open, input.filename, input.overrides);
  const batchSize = input.batch ?? 1000;
  const head: Array<{ line: number; cells: string[] }> = [];
  const HEAD = 40;
  let headerLine = 0;
  let headers: string[] | null = null;
  let profiler: Profiler | null = null;
  const samples: string[][] = [];
  let rowNo = 0;
  let buffer: Array<{ row_no: number; line_no: number; raw: string[] }> = [];

  const addData = async (line: number, cells: string[]): Promise<void> => {
    if (cells.every((c) => c.trim() === '')) return; // an empty row inside the data
    rowNo++;
    if (rowNo > input.maxRows) {
      throw new FileFormatError(
        `The file has more than ${input.maxRows.toLocaleString('en')} data rows, which is the most one import takes. Split the file and import it in parts.`,
      );
    }
    const width = headers!.length;
    const raw = cells.length > width ? cells.slice(0, width) : cells;
    profiler!.add(raw);
    if (samples.length < 50) samples.push(raw);
    buffer.push({ row_no: rowNo, line_no: line, raw });
    if (buffer.length >= batchSize) {
      const out = buffer;
      buffer = [];
      await input.sink(out);
    }
  };

  const startData = async (): Promise<void> => {
    const at = detectHeaderIndex(head as never, parse.header_line ?? null);
    const headerRow = head[at]!;
    headerLine = headerRow.line;
    // the header is as wide as its last filled cell, or as the widest of the first rows
    let width = headerRow.cells.length;
    for (const r of head.slice(at + 1))
      width = Math.max(width, Math.min(r.cells.length, headerRow.cells.length + 20));
    const cells = [
      ...headerRow.cells,
      ...Array(Math.max(0, width - headerRow.cells.length)).fill(''),
    ];
    headers = headerNames(cells);
    profiler = new Profiler(headers);
    for (const r of head.slice(at + 1)) await addData(r.line, r.cells);
  };

  let started = false;
  for await (const row of readRows(input.open, parse)) {
    if (!started) {
      head.push(row);
      if (head.length >= HEAD) {
        started = true;
        await startData();
      }
    } else {
      await addData(row.line, row.cells);
    }
  }
  if (!started) {
    if (head.length === 0) throw new FileFormatError('The file is empty.');
    await startData();
  }
  if (buffer.length > 0) await input.sink(buffer);
  if (rowNo === 0) {
    throw new FileFormatError(
      `The file has a header row (row ${headerLine}) but no data rows below it.`,
    );
  }

  const suggestions = suggestMapping(input.entity, headers!, input.custom);
  const mapping: Mapping = {
    columns: suggestions.map((s) => ({ index: s.index, target: s.target })),
  };
  const confidence = Object.fromEntries(suggestions.map((s) => [s.index, s.confidence]));
  return {
    parse,
    headers: headers!,
    profile: profiler!.result(rowNo),
    samples,
    rowsTotal: rowNo,
    mapping,
    confidence,
    headerLine,
  };
}

export { CUSTOM_PREFIX };
