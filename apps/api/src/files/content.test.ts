import { describe, expect, it } from 'vitest';
import {
  csv,
  docx,
  exe,
  html,
  jpeg,
  pdf,
  plainZip,
  png,
  svg,
  webp,
  xlsx,
} from '../../test/support/file-fixtures.js';
import {
  ALLOWED_TYPES,
  checkDeclaredType,
  dispositionFor,
  extensionOf,
  findAllowedType,
  isThumbnailable,
  normalizeMime,
  sniffContent,
} from './content.js';

const sniff = async (mime: string, body: Buffer) => {
  const type = findAllowedType(mime)!;
  return sniffContent(body, type);
};

describe('upload allow-list (M2-FILE-01, M2-SEC-02)', () => {
  it('allows images, PDF, office formats and CSV', () => {
    const mimes = ALLOWED_TYPES.map((t) => t.mime);
    expect(mimes).toEqual(
      expect.arrayContaining([
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'application/pdf',
        'text/csv',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ]),
    );
  });

  it('never allows SVG, HTML, XML, scripts, archives or executables', () => {
    for (const mime of [
      'image/svg+xml',
      'text/html',
      'application/xhtml+xml',
      'text/xml',
      'application/xml',
      'application/javascript',
      'text/javascript',
      'application/zip',
      'application/x-msdownload',
      'application/octet-stream',
      'text/plain',
      'application/json',
    ]) {
      expect(findAllowedType(mime), mime).toBeUndefined();
      expect(checkDeclaredType(mime, 'x.bin').ok).toBe(false);
    }
  });

  it('the extension must fit the declared type', () => {
    expect(checkDeclaredType('image/png', 'a.png').ok).toBe(true);
    expect(checkDeclaredType('image/jpeg', 'A.JPG').ok).toBe(true);
    expect(checkDeclaredType('text/csv; charset=utf-8', 'rows.csv').ok).toBe(true);
    for (const [mime, name] of [
      ['image/png', 'a.html'],
      ['image/png', 'a.svg'],
      ['image/png', 'a'],
      ['application/pdf', 'a.pdf.exe'],
      ['text/csv', 'a.html'],
      ['image/jpeg', 'a.png'],
    ] as const) {
      expect(checkDeclaredType(mime, name).ok, `${mime} ${name}`).toBe(false);
    }
  });

  it('helpers', () => {
    expect(extensionOf('a.tar.gz')).toBe('gz');
    expect(extensionOf('.hidden')).toBe('');
    expect(extensionOf('noext')).toBe('');
    expect(normalizeMime(' Image/PNG ; x=y')).toBe('image/png');
    expect(dispositionFor('image/png')).toBe('inline');
    expect(dispositionFor('application/pdf')).toBe('attachment');
    expect(dispositionFor('text/csv')).toBe('attachment');
    expect(isThumbnailable('image/webp')).toBe(true);
    expect(isThumbnailable('application/pdf')).toBe(false);
  });
});

describe('content sniffing (declared type versus the first bytes)', () => {
  it('accepts genuine files', async () => {
    expect((await sniff('image/png', await png())).ok).toBe(true);
    expect((await sniff('image/jpeg', await jpeg())).ok).toBe(true);
    expect((await sniff('image/webp', await webp())).ok).toBe(true);
    expect((await sniff('application/pdf', pdf())).ok).toBe(true);
    expect((await sniff('text/csv', csv())).ok).toBe(true);
    expect(
      (
        await sniff(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          docx(),
        )
      ).ok,
    ).toBe(true);
    expect(
      (await sniff('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsx())).ok,
    ).toBe(true);
  });

  it('rejects content that is not what it claims', async () => {
    const cases: Array<[string, Buffer, string]> = [
      ['image/png', await jpeg(), 'jpeg labelled png'],
      ['image/jpeg', svg(), 'svg labelled jpeg'],
      ['image/png', html(), 'html labelled png'],
      ['application/pdf', await png(), 'png labelled pdf'],
      ['application/pdf', exe(), 'exe labelled pdf'],
      ['text/csv', exe(), 'exe labelled csv'],
      ['text/csv', await png(), 'png labelled csv'],
      ['text/csv', html(), 'html labelled csv'],
      ['text/csv', svg(), 'svg labelled csv'],
      ['text/csv', Buffer.from('a,b\n<script>alert(1)</script>,x\n'), 'script inside csv'],
      ['text/csv', Buffer.from([0x61, 0x2c, 0x00, 0x62]), 'NUL byte in csv'],
      ['text/csv', Buffer.from([0xff, 0xfe, 0xfd, 0x80, 0x81]), 'invalid utf-8 csv'],
      [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        pdf(),
        'pdf labelled docx',
      ],
      [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        exe(),
        'exe labelled docx',
      ],
      ['image/png', Buffer.alloc(0), 'empty'],
    ];
    for (const [mime, body, why] of cases) {
      expect((await sniff(mime, body)).ok, why).toBe(false);
    }
  });

  it('a plain zip is tolerated only where an office container is declared (still scanned and served as a download)', async () => {
    expect(
      (
        await sniff(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          plainZip(),
        )
      ).ok,
    ).toBe(true);
    expect((await sniff('image/png', plainZip())).ok).toBe(false);
    expect((await sniff('application/pdf', plainZip())).ok).toBe(false);
  });

  it('a CSV with a UTF-8 BOM and a multi-byte character cut at the sample boundary is fine', async () => {
    const body = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('name\nCafé\n'),
      Buffer.from([0xe2, 0x82]),
    ]);
    expect((await sniff('text/csv', body)).ok).toBe(true);
  });
});

describe('CSV files for the importer (M2-IMP-02)', () => {
  const importFile = (body: Buffer) =>
    sniffContent(body, findAllowedType('text/csv')!, { importFile: true });

  it('accepts UTF-16 (with a byte order mark) and Windows-1252 text only as an import file', async () => {
    const u16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('serial;name\r\n1;Ase\r\n', 'utf16le'),
    ]);
    const cp1252 = Buffer.from([0x6e, 0x0a, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x0a]);
    expect((await importFile(u16)).ok).toBe(true);
    expect((await importFile(cp1252)).ok).toBe(true);
    // an ordinary attachment is still UTF-8 text without NUL bytes
    expect((await sniff('text/csv', u16)).ok).toBe(false);
    expect((await sniff('text/csv', cp1252)).ok).toBe(false);
  });

  it('still refuses binary data and markup, whatever the encoding', async () => {
    expect((await importFile(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00]))).ok).toBe(false);
    const svg16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('<svg onload=x>', 'utf16le'),
    ]);
    expect((await importFile(svg16)).ok).toBe(false);
    expect((await importFile(Buffer.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0xfc]))).ok).toBe(
      false,
    );
  });
});

describe('.txt and .tsv text for the importer (M2-IMP-10, ED-40)', () => {
  const asImport = (mime: string, name: string) =>
    checkDeclaredType(mime, name, { importFile: true });

  it('an import file may be .csv, .tsv or .txt, declared as CSV, plain or tab-separated text, and is stored as text/csv', () => {
    for (const mime of ['text/csv', 'text/plain', 'Text/Tab-Separated-Values; charset=utf-16']) {
      for (const name of ['rows.csv', 'Unicode text.TXT', 'export.tsv']) {
        const check = asImport(mime, name);
        expect(check.ok, `${mime} ${name}`).toBe(true);
        if (check.ok) expect(check.type.mime).toBe('text/csv');
      }
    }
    // the XLSX type keeps its own extension
    expect(
      asImport('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx').ok,
    ).toBe(true);
  });

  it('other names and types stay refused for an import file', () => {
    for (const [mime, name] of [
      ['text/plain', 'a.html'],
      ['text/plain', 'a.svg'],
      ['text/plain', 'a'],
      ['text/tab-separated-values', 'a.txt.exe'],
      ['text/csv', 'a.xml'],
      ['text/html', 'a.txt'],
      ['application/octet-stream', 'a.txt'],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.txt'],
    ] as const) {
      const check = asImport(mime, name);
      expect(check.ok, `${mime} ${name}`).toBe(false);
    }
    expect(asImport('text/plain', 'a.html')).toMatchObject({
      reason: expect.stringContaining('expected .csv, .tsv, .txt'),
    });
  });

  it('every other kind of attachment keeps .csv only and has no text/plain', () => {
    expect(checkDeclaredType('text/csv', 'a.txt').ok).toBe(false);
    expect(checkDeclaredType('text/csv', 'a.tsv').ok).toBe(false);
    expect(checkDeclaredType('text/plain', 'a.txt').ok).toBe(false);
    expect(checkDeclaredType('text/tab-separated-values', 'a.tsv').ok).toBe(false);
  });

  it('a .txt import file is sniffed as strictly as a CSV: UTF-16 text passes, markup and binary do not', async () => {
    const check = asImport('text/plain', 'Unicode text.txt');
    if (!check.ok) throw new Error(check.reason);
    const sniffImport = (body: Buffer) => sniffContent(body, check.type, { importFile: true });
    const u16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('Asset Tag\tName\r\nA-1\tLaptop\r\n', 'utf16le'),
    ]);
    expect((await sniffImport(u16)).ok).toBe(true);
    expect((await sniffImport(html())).ok).toBe(false);
    expect((await sniffImport(svg())).ok).toBe(false);
    expect((await sniffImport(await png())).ok).toBe(false);
    expect((await sniffImport(exe())).ok).toBe(false);
    expect(
      (
        await sniffImport(
          Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a\tb\r\n<script>x', 'utf16le')]),
        )
      ).ok,
    ).toBe(false);
  });
});
