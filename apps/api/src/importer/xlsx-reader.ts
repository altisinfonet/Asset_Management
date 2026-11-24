import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SaxesParser, type SaxesTagPlain } from 'saxes';
import yauzl from 'yauzl';
import { FileFormatError, MAX_CELLS, MAX_CELL_CHARS, type RawRow } from './csv-reader.js';

/**
 * XLSX reading for the importer (M2-IMP-02).
 *
 * Library choice (ADR 0010): `yauzl` (random-access zip reader, maintained, streams each entry) and
 * `saxes` (the SAX XML parser jsdom uses). A spreadsheet is a zip whose shared-string table usually sits
 * AFTER the sheets, so a one-pass stream cannot be decoded; the object store stream is therefore spooled to
 * a temporary FILE (never into memory), the central directory gives random access, and the sheet XML is
 * parsed as a stream, one cell at a time. Memory is bounded by the shared-string table (capped) and one
 * chunk of XML. Zip bombs are refused by caps on the uncompressed sizes (declared and actually inflated).
 * SheetJS/`xlsx` was rejected (the npm package is unmaintained and carries known CVEs), `exceljs` (last
 * release 2024, large dependency tree) and `read-excel-file` (loads the sheet into memory) as well.
 */

/** Caps against decompression bombs and absurd workbooks. */
export const XLSX_LIMITS = {
  /** Largest sheet XML (uncompressed). 100,000 rows of 20 cells is about 150 MB of XML. */
  sheetBytes: 600 * 1024 * 1024,
  /** Total characters of the shared-string table. */
  sharedStringChars: 64 * 1024 * 1024,
  /** Largest side part (workbook, styles, rels). */
  partBytes: 32 * 1024 * 1024,
  /** Entries in the zip. */
  entries: 2000,
} as const;

export interface XlsxSheet {
  name: string;
  path: string;
  hidden: boolean;
}

/** An opened workbook backed by a spooled temporary file; `close()` removes it. */
export class XlsxWorkbook {
  private constructor(
    private readonly zip: yauzl.ZipFile,
    private readonly dir: string,
    private readonly parts: Map<string, yauzl.Entry>,
    readonly sheets: XlsxSheet[],
    private readonly sharedStrings: () => Promise<string[]>,
    private readonly dateStyles: () => Promise<Set<number>>,
    readonly date1904: boolean,
  ) {}

  /** Spools `source` to a temporary file and reads the workbook structure. */
  static async open(source: Readable): Promise<XlsxWorkbook> {
    const dir = await mkdtemp(join(tmpdir(), 'at-import-'));
    const file = join(dir, 'book.xlsx');
    try {
      await pipeline(source, createWriteStream(file));
      const zip = await openZip(file);
      if (zip.entryCount > XLSX_LIMITS.entries) {
        zip.close();
        throw new FileFormatError('The workbook has too many parts; it is not a normal XLSX file.');
      }
      const parts = await listEntries(zip);
      const need = (name: string) => parts.get(name);
      const workbookEntry = need('xl/workbook.xml');
      if (!workbookEntry) {
        zip.close();
        throw new FileFormatError(
          'This is not an XLSX workbook (no xl/workbook.xml). Save the file as .xlsx or export it as CSV.',
        );
      }
      const workbookXml = await readPart(zip, workbookEntry, XLSX_LIMITS.partBytes);
      const relsEntry = need('xl/_rels/workbook.xml.rels');
      const relsXml = relsEntry ? await readPart(zip, relsEntry, XLSX_LIMITS.partBytes) : '';
      const { sheets: declared, date1904 } = parseWorkbook(workbookXml);
      const targets = parseRels(relsXml);
      const sheets: XlsxSheet[] = [];
      for (const s of declared) {
        const target = targets.get(s.rid);
        if (!target) continue;
        const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
        if (parts.has(path)) sheets.push({ name: s.name, path, hidden: s.hidden });
      }
      if (sheets.length === 0) {
        zip.close();
        throw new FileFormatError('The workbook has no readable sheet.');
      }
      let shared: Promise<string[]> | undefined;
      let styles: Promise<Set<number>> | undefined;
      const sharedEntry = need('xl/sharedStrings.xml');
      const stylesEntry = need('xl/styles.xml');
      return new XlsxWorkbook(
        zip,
        dir,
        parts,
        sheets,
        () => (shared ??= sharedEntry ? parseSharedStrings(zip, sharedEntry) : Promise.resolve([])),
        () =>
          (styles ??= stylesEntry ? parseDateStyles(zip, stylesEntry) : Promise.resolve(new Set())),
        date1904,
      );
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      if (err instanceof FileFormatError) throw err;
      throw new FileFormatError(
        `The file could not be read as an XLSX workbook (${err instanceof Error ? err.message : 'unknown error'}).`,
      );
    }
  }

  /** The sheet to read: the one named `name`, else the first visible one. */
  pick(name?: string | null): XlsxSheet {
    if (name) {
      const hit = this.sheets.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (!hit) {
        throw new FileFormatError(
          `The workbook has no sheet named "${name}". Sheets: ${this.sheets.map((s) => s.name).join(', ')}.`,
        );
      }
      return hit;
    }
    return this.sheets.find((s) => !s.hidden) ?? this.sheets[0]!;
  }

  /** Rows of a sheet, empty rows skipped. `line` is the spreadsheet row number. */
  async *rows(sheet: XlsxSheet): AsyncGenerator<RawRow> {
    const strings = await this.sharedStrings();
    const dateStyles = await this.dateStyles();
    const entry = this.parts.get(sheet.path);
    if (!entry) throw new FileFormatError(`Missing part ${sheet.path}.`);
    const stream = await openEntry(this.zip, entry);
    const queue: RawRow[] = [];
    const sheetParser = new SheetParser(strings, dateStyles, this.date1904, (row) =>
      queue.push(row),
    );
    let bytes = 0;
    try {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        bytes += chunk.length;
        if (bytes > XLSX_LIMITS.sheetBytes) {
          throw new FileFormatError(
            'The sheet is larger than the importer accepts (decompressed).',
          );
        }
        sheetParser.write(chunk.toString('utf8'));
        if (queue.length > 0) {
          const out = queue.splice(0, queue.length);
          for (const row of out) yield row;
        }
      }
      sheetParser.end();
      for (const row of queue.splice(0, queue.length)) yield row;
    } finally {
      stream.destroy();
    }
  }

  async close(): Promise<void> {
    try {
      this.zip.close();
    } catch {
      // already closed
    }
    await rm(this.dir, { recursive: true, force: true });
  }
}

// ----------------------------------------------------------------------------------- zip helpers

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      file,
      { lazyEntries: true, validateEntrySizes: true, autoClose: false },
      (err, zip) => {
        if (err || !zip) {
          reject(
            new FileFormatError(
              'The file is not a valid XLSX workbook (it is not a readable zip archive). Save it as .xlsx or export it as CSV.',
            ),
          );
        } else resolve(zip);
      },
    );
  });
}

/** Central directory: entry name -> entry. Entries that claim a huge inflated size are refused. */
function listEntries(zip: yauzl.ZipFile): Promise<Map<string, yauzl.Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, yauzl.Entry>();
    let total = 0;
    zip.on('entry', (entry: yauzl.Entry) => {
      total += entry.uncompressedSize;
      if (total > 4 * 1024 * 1024 * 1024) {
        reject(
          new FileFormatError('The workbook expands to an unreasonable size and was refused.'),
        );
        return;
      }
      if (!entry.fileName.endsWith('/')) entries.set(entry.fileName.replace(/^\/+/, ''), entry);
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', reject);
    zip.readEntry();
  });
}

function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error('cannot open zip entry'));
      else resolve(stream);
    });
  });
}

async function readPart(zip: yauzl.ZipFile, entry: yauzl.Entry, cap: number): Promise<string> {
  const stream = await openEntry(zip, entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > cap) {
      stream.destroy();
      throw new FileFormatError(`The workbook part ${entry.fileName} is too large.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------------------------- XML helpers

/** Runs `saxes` over a string and calls the handlers; a malformed document is a FileFormatError. */
function sax(
  xml: string,
  on: {
    open?: (tag: SaxesTagPlain) => void;
    close?: (tag: SaxesTagPlain) => void;
    text?: (t: string) => void;
  },
): void {
  const parser = new SaxesParser({ xmlns: false });
  if (on.open) parser.on('opentag', on.open);
  if (on.close) parser.on('closetag', on.close);
  if (on.text) parser.on('text', on.text);
  parser.on('error', (e) => {
    throw new FileFormatError(`The workbook contains malformed XML (${e.message}).`);
  });
  parser.write(xml).close();
}

const localName = (n: string): string => n.slice(n.indexOf(':') + 1);

function parseWorkbook(xml: string): {
  sheets: Array<{ name: string; rid: string; hidden: boolean }>;
  date1904: boolean;
} {
  const sheets: Array<{ name: string; rid: string; hidden: boolean }> = [];
  let date1904 = false;
  sax(xml, {
    open(tag) {
      const n = localName(tag.name);
      if (n === 'sheet') {
        const a = tag.attributes as Record<string, string>;
        sheets.push({
          name: a.name ?? `Sheet${sheets.length + 1}`,
          rid: a['r:id'] ?? '',
          hidden: a.state === 'hidden' || a.state === 'veryHidden',
        });
      } else if (n === 'workbookPr') {
        const v = (tag.attributes as Record<string, string>).date1904;
        date1904 = v === '1' || v === 'true';
      }
    },
  });
  return { sheets, date1904 };
}

function parseRels(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  sax(xml, {
    open(tag) {
      if (localName(tag.name) === 'Relationship') {
        const a = tag.attributes as Record<string, string>;
        if (a.Id && a.Target) map.set(a.Id, a.Target);
      }
    },
  });
  return map;
}

/** `_x000D_` style escapes of XLSX strings. */
function unescapeXlsx(text: string): string {
  return text.includes('_x')
    ? text.replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    : text;
}

async function parseSharedStrings(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<string[]> {
  const stream = await openEntry(zip, entry);
  const strings: string[] = [];
  let chars = 0;
  let current = '';
  let inSi = false;
  let inT = false;
  let skip = 0; // inside <rPh> (phonetic runs): not part of the text
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (tag) => {
    const n = localName(tag.name);
    if (n === 'si') {
      inSi = true;
      current = '';
    } else if (n === 'rPh') skip++;
    else if (n === 't' && inSi && skip === 0) inT = true;
  });
  parser.on('text', (t) => {
    if (inT) current += t;
  });
  parser.on('closetag', (tag) => {
    const n = localName(tag.name);
    if (n === 't') inT = false;
    else if (n === 'rPh') skip--;
    else if (n === 'si') {
      inSi = false;
      const value = unescapeXlsx(current);
      chars += value.length;
      if (chars > XLSX_LIMITS.sharedStringChars) {
        throw new FileFormatError('The workbook has more text than the importer accepts.');
      }
      strings.push(value);
    }
  });
  parser.on('error', (e) => {
    throw new FileFormatError(`The workbook contains malformed XML (${e.message}).`);
  });
  for await (const chunk of stream as AsyncIterable<Buffer>) parser.write(chunk.toString('utf8'));
  parser.close();
  return strings;
}

/** Built-in number formats that are dates or times (ECMA-376 18.8.30). */
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

/** Style (cellXfs) indexes whose number format is a date or time. */
async function parseDateStyles(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Set<number>> {
  const xml = await readPart(zip, entry, XLSX_LIMITS.partBytes);
  const custom = new Map<number, boolean>();
  const xfs: number[] = [];
  let inCellXfs = false;
  sax(xml, {
    open(tag) {
      const n = localName(tag.name);
      const a = tag.attributes as Record<string, string>;
      if (n === 'numFmt' && a.numFmtId && a.formatCode !== undefined) {
        custom.set(Number(a.numFmtId), looksLikeDateFormat(a.formatCode));
      } else if (n === 'cellXfs') inCellXfs = true;
      else if (n === 'xf' && inCellXfs) xfs.push(Number(a.numFmtId ?? 0));
    },
    close(tag) {
      if (localName(tag.name) === 'cellXfs') inCellXfs = false;
    },
  });
  const out = new Set<number>();
  xfs.forEach((fmt, index) => {
    if (BUILTIN_DATE_FORMATS.has(fmt) || custom.get(fmt)) out.add(index);
  });
  return out;
}

/** A custom format code with a date or time token outside quotes, brackets and escapes. */
export function looksLikeDateFormat(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .replace(/_./g, '')
    .replace(/\*./g, '');
  return /[dmyhs]/i.test(stripped.replace(/e[+-]/gi, ''));
}

// ------------------------------------------------------------------------------- the sheet itself

/** Column index (0-based) of the letters of a cell reference (`AB12` -> 27). */
export function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

const MS_PER_DAY = 86_400_000;

/** An Excel serial number as `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM:SS` or `HH:MM:SS` (a time of day only). */
export function serialToText(serial: number, date1904: boolean): string {
  const whole = Math.floor(serial);
  const frac = serial - whole;
  const secs = Math.round(frac * 86_400);
  const hh = String(Math.floor(secs / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  if (whole === 0) return `${hh}:${mm}:${ss}`;
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, whole >= 60 ? 30 : 31);
  const d = new Date(base + whole * MS_PER_DAY);
  const day = d.toISOString().slice(0, 10);
  return secs === 0 ? day : `${day}T${hh}:${mm}:${ss}`;
}

class SheetParser {
  private readonly parser = new SaxesParser({ xmlns: false });
  private row: string[] = [];
  private rowNo = 0;
  private inRow = false;
  private cellRef = '';
  private cellType = '';
  private cellStyle = -1;
  private v = '';
  private inV = false;
  private inIs = false;
  private inT = false;
  private skip = 0;
  private isText = '';
  private rowCount = 0;

  constructor(
    private readonly strings: string[],
    private readonly dateStyles: Set<number>,
    private readonly date1904: boolean,
    private readonly emit: (row: RawRow) => void,
  ) {
    const p = this.parser;
    p.on('opentag', (tag) => this.open(tag));
    p.on('text', (t) => this.text(t));
    p.on('closetag', (tag) => this.close(tag));
    p.on('error', (e) => {
      throw new FileFormatError(`The sheet contains malformed XML (${e.message}).`);
    });
  }

  write(xml: string): void {
    this.parser.write(xml);
  }
  end(): void {
    this.parser.close();
  }

  private open(tag: SaxesTagPlain): void {
    const n = localName(tag.name);
    const a = tag.attributes as Record<string, string>;
    if (n === 'row') {
      this.inRow = true;
      this.rowCount++;
      this.rowNo = a.r ? Number(a.r) : this.rowNo + 1;
      this.row = [];
    } else if (n === 'c' && this.inRow) {
      this.cellRef = a.r ?? '';
      this.cellType = a.t ?? '';
      this.cellStyle = a.s !== undefined ? Number(a.s) : -1;
      this.v = '';
      this.isText = '';
    } else if (n === 'v') this.inV = true;
    else if (n === 'is') this.inIs = true;
    else if (n === 'rPh') this.skip++;
    else if (n === 't' && this.inIs && this.skip === 0) this.inT = true;
  }

  private text(t: string): void {
    if (this.inV) this.v += t;
    else if (this.inT) this.isText += t;
  }

  private close(tag: SaxesTagPlain): void {
    const n = localName(tag.name);
    if (n === 'v') this.inV = false;
    else if (n === 't') this.inT = false;
    else if (n === 'is') this.inIs = false;
    else if (n === 'rPh') this.skip--;
    else if (n === 'c' && this.inRow) {
      const col = this.cellRef ? columnIndex(this.cellRef) : this.row.length;
      if (col >= MAX_CELLS) {
        if (this.cellValue() !== '') {
          throw new FileFormatError(
            `Row ${this.rowNo}: more than ${MAX_CELLS} columns.`,
            this.rowNo,
          );
        }
        return;
      }
      while (this.row.length < col) this.row.push('');
      const value = this.cellValue();
      if (value.length > MAX_CELL_CHARS) {
        throw new FileFormatError(
          `Row ${this.rowNo}: a cell is longer than ${MAX_CELL_CHARS.toLocaleString('en')} characters.`,
          this.rowNo,
        );
      }
      this.row[col] = value;
    } else if (n === 'row' && this.inRow) {
      this.inRow = false;
      if (this.row.some((c) => c.trim() !== '')) {
        // trailing empty cells carry no information
        let end = this.row.length;
        while (end > 0 && this.row[end - 1] === '') end--;
        this.emit({ line: this.rowNo, cells: this.row.slice(0, end) });
      }
    }
  }

  private cellValue(): string {
    switch (this.cellType) {
      case 's': {
        const s = this.strings[Number(this.v)];
        return s ?? '';
      }
      case 'inlineStr':
        return unescapeXlsx(this.isText);
      case 'str':
        return unescapeXlsx(this.v);
      case 'b':
        return this.v.trim() === '1' ? 'TRUE' : 'FALSE';
      case 'e':
        return this.v;
      case 'd':
        return this.v.slice(0, 19);
      default: {
        const raw = this.v.trim();
        if (raw === '') return '';
        if (this.dateStyles.has(this.cellStyle)) {
          const serial = Number(raw);
          if (Number.isFinite(serial) && serial >= 0 && serial < 2_958_466) {
            return serialToText(serial, this.date1904);
          }
        }
        return raw;
      }
    }
  }
}
