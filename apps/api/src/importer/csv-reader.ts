/**
 * Streaming CSV reading for the importer (M2-IMP-02): encoding detection (UTF-8 with or without a byte
 * order mark, UTF-16 LE/BE, Windows-1252), delimiter sniffing, quoted fields with line breaks, empty
 * lines skipped, and an actionable error (line number and reason) for a malformed file. The file is
 * consumed as a stream of byte chunks and decoded incrementally, so a 100,000-row file is never held in
 * memory; only one record at a time is.
 */

export type CsvEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';
export const CSV_ENCODINGS: readonly CsvEncoding[] = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'windows-1252',
];
export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/** A record is at most this many cells and each cell at most this many characters. */
export const MAX_CELLS = 500;
export const MAX_CELL_CHARS = 32_000;

/** A malformed file: the line it starts on and what is wrong. The message is shown to the user. */
export class FileFormatError extends Error {
  constructor(
    message: string,
    readonly line: number | null = null,
  ) {
    super(message);
    this.name = 'FileFormatError';
  }
}

export interface RawRow {
  /** 1-based line (CSV) or row (XLSX) of the file this record starts on. */
  line: number;
  cells: string[];
}

/** Byte-order mark, or a UTF-16 pattern, or `null` when the bytes say nothing yet. */
export function sniffBom(head: Uint8Array): CsvEncoding | null {
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return 'utf-8';
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  // UTF-16 without a BOM: ASCII text has a NUL in every second byte.
  let even = 0;
  let odd = 0;
  const n = Math.min(head.length, 4096);
  for (let i = 0; i < n; i++) {
    if (head[i] === 0) {
      if (i % 2 === 0) even++;
      else odd++;
    }
  }
  if (n >= 8 && odd > n / 8 && even === 0) return 'utf-16le';
  if (n >= 8 && even > n / 8 && odd === 0) return 'utf-16be';
  return null;
}

/**
 * The encoding of a whole file, read as a stream: a byte order mark or UTF-16 pattern wins; otherwise
 * UTF-8 when EVERY byte sequence is valid UTF-8, else Windows-1252 (the code page of "CSV" saved by
 * Excel on Windows). A NUL byte in a non-UTF-16 file means it is not text.
 */
export async function detectEncoding(chunks: AsyncIterable<Uint8Array>): Promise<CsvEncoding> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let first = true;
  let utf8 = true;
  let sawNul = false;
  for await (const chunk of chunks) {
    if (first) {
      first = false;
      const bom = sniffBom(chunk);
      if (bom) return bom;
    }
    if (chunk.includes(0)) sawNul = true;
    if (utf8) {
      try {
        decoder.decode(chunk, { stream: true });
      } catch {
        utf8 = false;
      }
    }
  }
  if (sawNul)
    throw new FileFormatError(
      'The file contains binary data (NUL bytes); it is not a text CSV file.',
    );
  if (utf8) {
    try {
      decoder.decode();
    } catch {
      utf8 = false;
    }
  }
  return utf8 ? 'utf-8' : 'windows-1252';
}

/** The delimiter that splits the sampled lines into the same number (>= 2) of cells most consistently. */
export function sniffDelimiter(sample: string): CsvDelimiter {
  const lines: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of sample) {
    if (ch === '"') quoted = !quoted;
    if ((ch === '\n' || ch === '\r') && !quoted) {
      if (current.length > 0) lines.push(current);
      current = '';
      if (lines.length >= 25) break;
    } else current += ch;
  }
  if (current.length > 0 && lines.length < 25) lines.push(current);

  let best: CsvDelimiter = ',';
  let bestScore = 0;
  for (const d of CSV_DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const tally = new Map<number, number>();
    for (const c of counts) if (c > 0) tally.set(c, (tally.get(c) ?? 0) + 1);
    let modeCount = 0;
    let modeLines = 0;
    for (const [c, n] of tally) {
      if (n > modeLines || (n === modeLines && c > modeCount)) {
        modeCount = c;
        modeLines = n;
      }
    }
    // consistent lines first, then the number of columns; a comma wins a tie (the default)
    const score = modeLines * 1000 + modeCount;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let n = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) n++;
  }
  return n;
}

/**
 * Incremental record parser (RFC 4180 plus the usual leniencies): a quote starts a quoted field only at
 * the start of a field; `""` inside a quoted field is one quote; a lone quote inside an unquoted field is
 * kept as it is (a 14" laptop); text after a closing quote, and an unterminated quote, are errors with the
 * line they start on. CRLF, LF and CR end a record; blank lines are skipped.
 */
export class CsvParser {
  private row: string[] = [];
  private field = '';
  private state: 'start' | 'unquoted' | 'quoted' | 'after-quote' = 'start';
  private line = 1;
  private recordLine = 1;
  private quoteLine = 1;
  private pendingCr = false;
  private hasContent = false;

  constructor(private readonly delimiter: string) {}

  /** Feeds decoded text; returns the records completed by it. */
  push(text: string): RawRow[] {
    const out: RawRow[] = [];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (this.pendingCr) {
        this.pendingCr = false;
        if (c === 10) continue; // the LF of a CRLF
      }
      switch (this.state) {
        case 'start':
        case 'unquoted': {
          if (c === 34 && this.state === 'start') {
            this.state = 'quoted';
            this.quoteLine = this.line;
            this.hasContent = true;
          } else if (text[i] === this.delimiter) {
            this.endField();
            this.state = 'start';
            this.hasContent = true;
          } else if (c === 10 || c === 13) {
            this.endRecord(out);
            this.line++;
            if (c === 13) this.pendingCr = true;
          } else {
            if (this.field.length === 0 && this.state === 'start') this.hasContent = true;
            this.state = 'unquoted';
            this.field += text[i];
            this.guardCell();
          }
          break;
        }
        case 'quoted': {
          if (c === 34) {
            // `""` stays inside the field; a single quote may close it (decided by the next character)
            this.state = 'after-quote';
          } else {
            if (c === 10) this.line++;
            else if (c === 13) {
              this.line++;
              this.pendingCr = true;
              this.field += '\n';
              break;
            }
            this.field += text[i];
            this.guardCell();
          }
          break;
        }
        case 'after-quote': {
          if (c === 34) {
            this.field += '"';
            this.state = 'quoted';
          } else if (text[i] === this.delimiter) {
            this.endField();
            this.state = 'start';
          } else if (c === 10 || c === 13) {
            this.endRecord(out);
            this.line++;
            if (c === 13) this.pendingCr = true;
          } else {
            throw new FileFormatError(
              `Line ${this.line}: unexpected text after the closing quote of a field. Quote characters inside a quoted field must be doubled ("").`,
              this.line,
            );
          }
          break;
        }
      }
    }
    return out;
  }

  /** End of input: the last record, or an error for an unterminated quote. */
  finish(): RawRow[] {
    const out: RawRow[] = [];
    if (this.state === 'quoted') {
      throw new FileFormatError(
        `Line ${this.quoteLine}: a quoted field is never closed (missing closing quote).`,
        this.quoteLine,
      );
    }
    if (this.hasContent || this.field.length > 0 || this.row.length > 0) this.endRecord(out);
    return out;
  }

  private guardCell(): void {
    if (this.field.length > MAX_CELL_CHARS) {
      throw new FileFormatError(
        `Line ${this.recordLine}: a cell is longer than ${MAX_CELL_CHARS.toLocaleString('en')} characters.`,
        this.recordLine,
      );
    }
  }

  private endField(): void {
    this.row.push(this.field);
    this.field = '';
    if (this.row.length > MAX_CELLS) {
      throw new FileFormatError(
        `Line ${this.recordLine}: more than ${MAX_CELLS} columns. Is the delimiter right?`,
        this.recordLine,
      );
    }
  }

  private endRecord(out: RawRow[]): void {
    if (this.hasContent || this.field.length > 0 || this.row.length > 0) {
      this.endField();
      const blank = this.row.length === 1 && this.row[0] === '';
      if (!blank) out.push({ line: this.recordLine, cells: this.row });
    }
    this.row = [];
    this.field = '';
    this.state = 'start';
    this.hasContent = false;
    this.recordLine = this.line + 1;
  }
}

/** Decodes a byte stream with `encoding` into text chunks (the BOM is dropped). */
export async function* decodeChunks(
  chunks: AsyncIterable<Uint8Array>,
  encoding: CsvEncoding,
): AsyncGenerator<string> {
  const decoder = new TextDecoder(encoding, { fatal: false, ignoreBOM: false });
  for await (const chunk of chunks) {
    const text = decoder.decode(chunk, { stream: true });
    if (text.length > 0) yield text;
  }
  const rest = decoder.decode();
  if (rest.length > 0) yield rest;
}

/** Records of a CSV byte stream. */
export async function* csvRows(
  chunks: AsyncIterable<Uint8Array>,
  encoding: CsvEncoding,
  delimiter: string,
): AsyncGenerator<RawRow> {
  const parser = new CsvParser(delimiter);
  for await (const text of decodeChunks(chunks, encoding)) {
    yield* parser.push(text);
  }
  yield* parser.finish();
}

/** Decoded prefix of a byte stream, for delimiter sniffing (stops reading after `chars`). */
export async function samplePrefix(
  chunks: AsyncIterable<Uint8Array>,
  encoding: CsvEncoding,
  chars = 65_536,
): Promise<string> {
  let text = '';
  for await (const part of decodeChunks(chunks, encoding)) {
    text += part;
    if (text.length >= chars) break;
  }
  return text.slice(0, chars);
}
