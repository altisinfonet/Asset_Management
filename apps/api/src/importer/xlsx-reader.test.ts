import { Readable } from 'node:stream';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { FileFormatError } from './csv-reader.js';
import { PRESETS } from './presets.js';
import { analyseFile } from './analysis.js';
import { templateOf, templateXlsx } from './template-files.js';
import { XlsxWorkbook, columnIndex, looksLikeDateFormat, serialToText } from './xlsx-reader.js';

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

/** An Excel-like workbook: the shared strings come AFTER the sheet in the archive, dates are styled serials. */
function workbook(): Buffer {
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(
      `<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets><sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Devices" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/><Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="x"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet ${NS}><sheetData>` +
        `<row r="1"><c r="A1" t="s"><v>0</v></c></row>` + // a title line
        `<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="s"><v>2</v></c><c r="D3" t="s"><v>3</v></c></row>` +
        `<row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4" s="1"><v>45358</v></c><c r="C4" t="b"><v>1</v></c><c r="D4" t="inlineStr"><is><t>a_x000D_b</t></is></c></row>` +
        `<row r="5"><c r="A5" t="s"><v>5</v></c><c r="B5" s="1"><v>45359</v></c></row>` +
        `<row r="6"><c r="A6"/></row>` +
        `<row r="7"><c r="A7" t="str"><v>formula text</v></c></row>` +
        `</sheetData></worksheet>`,
    ),
    'xl/worksheets/sheet2.xml': strToU8(
      `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hidden</t></is></c></row></sheetData></worksheet>`,
    ),
    'xl/styles.xml': strToU8(
      `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
    ),
    // after the sheets, as Excel writes it
    'xl/sharedStrings.xml': strToU8(
      `<sst ${NS}><si><t>Asset register</t></si><si><t>Serial</t></si><si><r><t>Purchase</t></r><r><t> date</t></r></si><si><t>Notes</t></si><si><t>SN-1</t></si><si><t>SN-2</t></si></sst>`,
    ),
  };
  return Buffer.from(zipSync(files));
}

describe('xlsx reader (M2-IMP-02)', () => {
  it('reads shared strings (placed after the sheet), styled dates, sparse cells, booleans and inline strings', async () => {
    const book = await XlsxWorkbook.open(Readable.from([workbook()]));
    try {
      expect(book.sheets.map((s) => [s.name, s.hidden])).toEqual([
        ['Hidden', true],
        ['Devices', false],
      ]);
      expect(book.pick().name).toBe('Devices'); // the first visible sheet
      const rows: Array<{ line: number; cells: string[] }> = [];
      for await (const r of book.rows(book.pick())) rows.push(r);
      expect(rows).toEqual([
        { line: 1, cells: ['Asset register'] },
        { line: 3, cells: ['Serial', 'Purchase date', '', 'Notes'] },
        { line: 4, cells: ['SN-1', '2024-03-07', 'TRUE', 'a\rb'] },
        { line: 5, cells: ['SN-2', '2024-03-08'] },
        { line: 7, cells: ['formula text'] },
      ]);
      expect(() => book.pick('Nope')).toThrow(/no sheet named/);
    } finally {
      await book.close();
    }
  });

  it('analyses a workbook end to end (title row skipped, header found)', async () => {
    const stored: unknown[] = [];
    const a = await analyseFile({
      open: () => Promise.resolve(Readable.from([workbook()])),
      filename: 'devices.xlsx',
      overrides: {},
      entity: 'asset',
      custom: [],
      maxRows: 10,
      sink: async (r) => void stored.push(...r),
    });
    expect(a.parse).toMatchObject({ format: 'xlsx', sheet: 'Devices' });
    expect(a.headerLine).toBe(3);
    expect(a.headers).toEqual(['Serial', 'Purchase date', 'Column C', 'Notes']);
    expect(a.rowsTotal).toBe(3);
    expect(a.profile[1]).toMatchObject({ type: 'date', date_order: 'iso' });
  });

  it('reads back the template workbook it writes (inline strings, a data dictionary on a second sheet)', async () => {
    const preset = PRESETS.find((p) => p.key === 'assets')!;
    const content = templateOf(preset, ['os']);
    const book = await XlsxWorkbook.open(Readable.from([templateXlsx(preset, content)]));
    try {
      expect(book.sheets.map((s) => s.name)).toEqual(['Template', 'Data dictionary']);
      const rows: string[][] = [];
      for await (const r of book.rows(book.pick())) rows.push(r.cells);
      expect(rows[0]).toEqual(content.headers);
      expect(rows[1]![0]).toBe('LAP-00101');
      expect(rows).toHaveLength(1 + content.rows.length);
    } finally {
      await book.close();
    }
  });

  it('refuses something that is not a workbook, with a sentence', async () => {
    await expect(
      XlsxWorkbook.open(Readable.from([Buffer.from('definitely not a zip file')])),
    ).rejects.toBeInstanceOf(FileFormatError);
    const plainZip = Buffer.from(zipSync({ 'hello.txt': strToU8('hi') }));
    await expect(XlsxWorkbook.open(Readable.from([plainZip]))).rejects.toThrow(
      /not an XLSX workbook/,
    );
  });

  it('refuses malformed sheet XML with an actionable error', async () => {
    const bad = Buffer.from(
      zipSync({
        'xl/workbook.xml': strToU8(
          `<workbook ${NS} xmlns:r="x"><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>`,
        ),
        'xl/_rels/workbook.xml.rels': strToU8(
          `<Relationships xmlns="x"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
        ),
        'xl/worksheets/sheet1.xml': strToU8(
          `<worksheet ${NS}><sheetData><row r="1"><c r="A1"><v>1</row></sheetData></worksheet>`,
        ),
      }),
    );
    const book = await XlsxWorkbook.open(Readable.from([bad]));
    try {
      await expect(async () => {
        for await (const r of book.rows(book.pick())) void r;
      }).rejects.toThrow(/malformed XML/);
    } finally {
      await book.close();
    }
  });
});

describe('xlsx helpers', () => {
  it('converts column letters and Excel serial numbers', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AB12')).toBe(27);
    expect(serialToText(45358, false)).toBe('2024-03-07');
    expect(serialToText(45358.5, false)).toBe('2024-03-07T12:00:00');
    expect(serialToText(0.25, false)).toBe('06:00:00');
    expect(serialToText(1, true)).toBe('1904-01-02');
  });

  it('tells date formats from number formats', () => {
    expect(looksLikeDateFormat('dd/mm/yyyy')).toBe(true);
    expect(looksLikeDateFormat('[$-409]mmm d, yyyy;@')).toBe(true);
    expect(looksLikeDateFormat('yyyy-mm-dd hh:mm:ss')).toBe(true);
    expect(looksLikeDateFormat('0.00E+00')).toBe(false);
    expect(looksLikeDateFormat('"d" #,##0')).toBe(false);
    expect(looksLikeDateFormat('#,##0.00')).toBe(false);
  });
});
