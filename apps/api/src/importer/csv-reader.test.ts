import { describe, expect, it } from 'vitest';
import {
  CsvParser,
  FileFormatError,
  csvRows,
  detectEncoding,
  sniffBom,
  sniffDelimiter,
} from './csv-reader.js';

async function* chunks(...parts: Array<Buffer | string>): AsyncGenerator<Uint8Array> {
  for (const p of parts) yield typeof p === 'string' ? Buffer.from(p, 'utf8') : p;
}
async function parse(text: string, delimiter = ','): Promise<string[][]> {
  const out: string[][] = [];
  for await (const r of csvRows(chunks(text), 'utf-8', delimiter)) out.push(r.cells);
  return out;
}

describe('csv reader (M2-IMP-02)', () => {
  it('reads quoted fields with delimiters, doubled quotes and line breaks', async () => {
    const rows = await parse('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n1,2,3\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
      ['1', '2', '3'],
    ]);
  });

  it('skips empty lines and handles LF, CRLF and a missing final newline', async () => {
    expect(await parse('a,b\n\n1,2\r\n\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps a stray quote inside an unquoted field (a 14" laptop)', async () => {
    expect(await parse('name,size\nLaptop,14"\n')).toEqual([
      ['name', 'size'],
      ['Laptop', '14"'],
    ]);
  });

  it('reports the line of text after a closing quote', async () => {
    await expect(parse('a,b\n"x"y,2\n')).rejects.toMatchObject({
      name: 'FileFormatError',
      line: 2,
    });
  });

  it('reports the line where an unterminated quote starts, not a stack trace', async () => {
    const err = await parse('a,b\n1,2\n3,"oops\n4,5\n').catch((e) => e as FileFormatError);
    expect(err).toBeInstanceOf(FileFormatError);
    expect((err as FileFormatError).line).toBe(3);
    expect((err as FileFormatError).message).toMatch(/Line 3.*never closed/);
  });

  it('numbers records by the line they start on, also after quoted line breaks', async () => {
    const parser = new CsvParser(',');
    const rows = [...parser.push('h\n"a\nb"\nz\n'), ...parser.finish()];
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it('parses across arbitrary chunk boundaries (incl. inside CRLF and escaped quotes)', async () => {
    const text = 'a,b\r\n"q""x",2\r\n';
    const out: string[][] = [];
    const bytes = Buffer.from(text);
    for await (const r of csvRows(chunks(...[...bytes].map((b) => Buffer.from([b]))), 'utf-8', ','))
      out.push(r.cells);
    expect(out).toEqual([
      ['a', 'b'],
      ['q"x', '2'],
    ]);
  });

  it('does not split a multi-byte character across chunks', async () => {
    const bytes = Buffer.from('name\nÅse Müller\n');
    const out: string[][] = [];
    for await (const r of csvRows(chunks(bytes.subarray(0, 7), bytes.subarray(7)), 'utf-8', ','))
      out.push(r.cells);
    expect(out[1]).toEqual(['Åse Müller']);
  });

  it('refuses a cell that is far too long and a record with too many columns', async () => {
    await expect(parse(`a\n${'x'.repeat(40_000)}\n`)).rejects.toBeInstanceOf(FileFormatError);
    await expect(parse(`${Array(600).fill('c').join(',')}\n`)).rejects.toMatchObject({ line: 1 });
  });
});

describe('encoding detection', () => {
  it('reads the byte order mark', () => {
    expect(sniffBom(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toBe('utf-8');
    expect(sniffBom(Buffer.from([0xff, 0xfe, 0x61, 0x00]))).toBe('utf-16le');
    expect(sniffBom(Buffer.from([0xfe, 0xff, 0x00, 0x61]))).toBe('utf-16be');
  });

  it('detects UTF-8, UTF-8 with BOM, UTF-16 and falls back to Windows-1252', async () => {
    expect(await detectEncoding(chunks('plain,ascii\n1,2\n'))).toBe('utf-8');
    expect(await detectEncoding(chunks('﻿name\nÅse\n'))).toBe('utf-8');
    expect(await detectEncoding(chunks(Buffer.from('﻿name\nx\n', 'utf16le')))).toBe('utf-16le');
    // "Müller" in Windows-1252 is not valid UTF-8
    expect(
      await detectEncoding(chunks(Buffer.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x0a]))),
    ).toBe('windows-1252');
  });

  it('decodes Windows-1252 and UTF-16 files into the right characters, BOM dropped', async () => {
    const cp = Buffer.from([0x6e, 0x0a, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x20, 0x80, 0x0a]); // Müller €
    const a: string[][] = [];
    for await (const r of csvRows(chunks(cp), 'windows-1252', ',')) a.push(r.cells);
    expect(a[1]).toEqual(['Müller €']);
    const u16 = Buffer.from('﻿n;m\n1;2\n', 'utf16le');
    const b: string[][] = [];
    for await (const r of csvRows(chunks(u16), 'utf-16le', ';')) b.push(r.cells);
    expect(b).toEqual([
      ['n', 'm'],
      ['1', '2'],
    ]);
    const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('h\nv\n')]);
    const c: string[][] = [];
    for await (const r of csvRows(chunks(utf8), 'utf-8', ',')) c.push(r.cells);
    expect(c[0]).toEqual(['h']);
  });

  it('refuses binary data', async () => {
    await expect(
      detectEncoding(chunks(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00]))),
    ).rejects.toBeInstanceOf(FileFormatError);
  });
});

describe('delimiter sniffing', () => {
  it('finds comma, semicolon, tab and pipe', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3\n4,5,6\n')).toBe(',');
    expect(sniffDelimiter('a;b;c\n1,5;2;3\n4;5,5;6\n')).toBe(';');
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t');
    expect(sniffDelimiter('a|b|c\n1|2|3\n')).toBe('|');
  });

  it('ignores delimiters inside quotes and defaults to a comma', () => {
    expect(sniffDelimiter('name,note\n"a;b;c;d","x;y"\n')).toBe(',');
    expect(sniffDelimiter('single column\nvalue\n')).toBe(',');
  });
});
