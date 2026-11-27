/**
 * The messy-file corpus of the importer (M2-IMP-09). Each fixture is one problem real spreadsheets have,
 * written byte for byte as the program that makes such files writes it (Excel's "CSV UTF-8" and "Unicode
 * text", a German Excel's semicolons, Windows-1252 from an old export, workbooks with merged title rows,
 * hidden sheets and formulas). The files are checked in under `fixtures/corpus/` (`.gitattributes` keeps
 * their bytes: no line-ending conversion) and `corpus.e2e.test.ts` runs each one through upload,
 * analysis, mapping, dry run and commit; it also checks that the checked-in bytes are what this module
 * builds, so a fixture changes only on purpose:
 *
 *   node apps/api/test/importer/corpus.ts apps/api/test/importer/fixtures/corpus
 *
 * The 100,000-row file is never checked in: `messyAssetCsv(rows)` generates it at test time, the same
 * bytes for the same `rows` (no clock, no randomness).
 */
import { strToU8, zipSync } from 'fflate';

// ------------------------------------------------------------------------------------- encoders

const BOM8 = '﻿';

/** Windows-1252 bytes of a text (the 0x80-0x9F block differs from Latin-1: the euro sign is 0x80). */
export function cp1252(text: string): Buffer {
  const HIGH: Record<string, number> = {
    '€': 0x80,
    '‚': 0x82,
    ƒ: 0x83,
    '„': 0x84,
    '…': 0x85,
    '†': 0x86,
    '‡': 0x87,
    ˆ: 0x88,
    '‰': 0x89,
    Š: 0x8a,
    '‹': 0x8b,
    Œ: 0x8c,
    Ž: 0x8e,
    '‘': 0x91,
    '’': 0x92,
    '“': 0x93,
    '”': 0x94,
    '•': 0x95,
    '–': 0x96,
    '—': 0x97,
    '˜': 0x98,
    '™': 0x99,
    š: 0x9a,
    '›': 0x9b,
    œ: 0x9c,
    ž: 0x9e,
    Ÿ: 0x9f,
  };
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (HIGH[ch] !== undefined) out.push(HIGH[ch]);
    else if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) out.push(code);
    else throw new Error(`"${ch}" has no Windows-1252 byte`);
  }
  return Buffer.from(out);
}

/** UTF-16 LE with its byte order mark, as Excel's "Unicode text" export writes it. */
export function utf16le(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

/** Joins rows with `delimiter`, quoting a cell only where it must be (as Excel does). */
export function delimited(rows: string[][], delimiter = ',', eol = '\r\n'): string {
  const q = (v: string) =>
    v.includes(delimiter) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return rows.map((r) => r.map(q).join(delimiter)).join(eol) + eol;
}

// ------------------------------------------------------------------------------------ xlsx writer

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A cell of the minimal workbook writer: shared text, a number (optionally styled), a formula, an error. */
export type XCell =
  | string
  | null
  | { n: number; s?: number }
  | { f: string; v: string; t?: 'n' | 'str' | 'e' | 'b' }
  | { inline: string };

interface XSheet {
  name: string;
  hidden?: boolean;
  rows: XCell[][];
  /** Merged ranges (`A1:F1`), written after the sheet data as Excel does. */
  merges?: string[];
  /** First row number (rows above it are absent from the XML, as Excel leaves blank rows out). */
  firstRow?: number;
}

const colName = (i: number): string => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/**
 * A small but complete XLSX (content types, relationships, styles, shared strings written AFTER the
 * sheets, as Excel orders the archive). Styles: 0 General, 1 built-in date 14 (`m/d/yyyy`), 2 the custom
 * date `dd.mm.yyyy`, 3 text (`@`), 4 a two-decimal number. A fixed timestamp keeps the bytes reproducible.
 */
export function xlsx(sheets: XSheet[]): Buffer {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const shared = (s: string) => {
    let i = index.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      index.set(s, i);
    }
    return i;
  };
  const sheetXml = (sheet: XSheet) => {
    const first = sheet.firstRow ?? 1;
    const rows = sheet.rows
      .map((cells, ri) => {
        const r = first + ri;
        const xml = cells
          .map((c, ci) => {
            const ref = `${colName(ci)}${r}`;
            if (c === null || c === '') return '';
            if (typeof c === 'string') return `<c r="${ref}" t="s"><v>${shared(c)}</v></c>`;
            if ('inline' in c)
              return `<c r="${ref}" t="inlineStr"><is><t>${esc(c.inline)}</t></is></c>`;
            if ('f' in c) {
              const t = c.t && c.t !== 'n' ? ` t="${c.t}"` : '';
              return `<c r="${ref}"${t}><f>${esc(c.f)}</f><v>${esc(c.v)}</v></c>`;
            }
            return `<c r="${ref}"${c.s ? ` s="${c.s}"` : ''}><v>${c.n}</v></c>`;
          })
          .join('');
        return xml ? `<row r="${r}">${xml}</row>` : '';
      })
      .join('');
    const merges = sheet.merges?.length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
      : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ${NS} ${NS_R}><sheetData>${rows}</sheetData>${merges}</worksheet>`;
  };
  const files: Record<string, Uint8Array> = {};
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  files['[Content_Types].xml'] = strToU8(
    `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
  );
  files['_rels/.rels'] = strToU8(
    `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  files['xl/workbook.xml'] = strToU8(
    `${head}<workbook ${NS} ${NS_R}><workbookPr/><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
  );
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  );
  files['xl/styles.xml'] = strToU8(
    `${head}<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  );
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  // after the sheets (the strings are collected while the sheets are written)
  files['xl/sharedStrings.xml'] = strToU8(
    `${head}<sst ${NS} count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`,
  );
  return Buffer.from(zipSync(files, { mtime: new Date('2025-01-01T00:00:00Z'), level: 6 }));
}

// ------------------------------------------------------------------------------------- fixtures

/** The asset columns most fixtures use (the generic asset template's own header names). */
export const H = [
  'Asset Tag',
  'Serial Number',
  'Name',
  'Category',
  'Purchase Date',
  'Cost',
  'Notes',
];

/** File name -> bytes. Every entry is one case of the corpus (see `corpus.e2e.test.ts` for the verdicts). */
export const CORPUS: Record<string, () => Buffer> = {
  // ---- encodings and line endings
  /** Excel "CSV UTF-8": a byte order mark, CRLF, accents, the euro sign, CJK. */
  'utf8-bom.csv': () =>
    Buffer.from(
      BOM8 +
        delimited([
          H,
          ['', 'U8-001', 'Portátil de José', 'Laptops', '2025-03-07', '1,249.00', 'Zoë’s spare'],
          ['', 'U8-002', 'Müller Überwachung', 'Monitors', '2025-03-08', '€349.90', 'Niño'],
          ['', 'U8-003', '東京オフィス', 'Monitors', '2025-03-09', '199', ''],
        ]),
      'utf8',
    ),
  /** Excel "Unicode text" (.txt): UTF-16 LE with a BOM, tab-delimited, CRLF, quotes only where needed. */
  'utf16le-unicode-text.txt': () =>
    utf16le(
      delimited(
        [
          H,
          ['', 'U16-001', 'François Dupré', 'Laptops', '2025-03-07', '1249.5', 'Łódź office'],
          ['', 'U16-002', 'Ærø Søndergård', 'Laptops', '2025-03-08', '€99', 'a "quoted" word'],
          ['', 'U16-003', 'Ελληνικά', 'Laptops', '', '', 'tab\tinside'],
        ],
        '\t',
      ),
    ),
  /** "CSV (Comma delimited)" from Excel on Windows: Windows-1252, no BOM, smart quotes and the euro sign. */
  'windows-1252.csv': () =>
    cp1252(
      delimited([
        H,
        ['', 'W-001', 'Café Zürich', 'Laptops', '2025-01-15', '€899.00', '“Señor Núñez” – Büro'],
        ['', 'W-002', 'Señora Muñoz', 'Laptops', '2025-01-16', '€1,099.00', 'Ångström'],
        ['', 'W-003', 'Ü-Wagen', 'Laptops', '', '', '½ price'],
      ]),
    ),
  /** A file edited on two systems: CRLF, LF and a lone CR end records; a quoted cell spans lines. */
  'mixed-line-endings.csv': () =>
    Buffer.from(
      'Asset Tag,Serial Number,Name,Category,Notes\r\n' +
        ',ML-001,One,Laptops,crlf\n' +
        ',ML-002,Two,Laptops,lf\r\n' +
        ',ML-003,Three,Laptops,"first line\r\nsecond line\nthird line"\r' +
        ',ML-004,Four,Laptops,after a lone CR\n',
      'utf8',
    ),

  // ---- delimiters and quoting
  /** A German / Dutch Excel: semicolons, `1.234,56` decimals, `31.12.2025` and `31/12/2025` dates. */
  'semicolon-european.csv': () =>
    Buffer.from(
      delimited(
        [
          [...H.slice(0, 6), 'Warranty End', 'Notes'],
          ['', 'EU-001', 'Laptop A', 'Laptops', '31.12.2025', '1.234,56', '31/12/2027', ''],
          ['', 'EU-002', 'Laptop B', 'Laptops', '01.02.2025', '999,90', '01/02/2027', ''],
          ['', 'EU-003', 'Laptop C', 'Laptops', '15.06.2024', '12.000', '15/06/2026', ''],
          ['', 'EU-004', 'Laptop D', 'Laptops', '5.3.2024', '1.299,00 €', '05/03/2026', 'a; b'],
          ['', 'EU-005', 'Laptop E', 'Laptops', '2024-11-30', '0,99', '', ''],
          ['', 'EU-006', 'Laptop F', 'Laptops', '', '12,500', '', 'three decimals'],
        ],
        ';',
      ),
      'utf8',
    ),
  /**
   * An Indian register (M2-IMP-09 trial finding, ED-40): rupee amounts written "Rs.44000/-", "Rs 44,000/-",
   * "INR 44000", "₹1,14,900.00" (lakh grouping), a bare "44000/-" and a word where the price should be.
   */
  'rupee-prices.csv': () =>
    Buffer.from(
      BOM8 +
        delimited([
          H,
          ['', 'RS-001', 'Laptop 1', 'Laptops', '', 'Rs.44000/-', ''],
          ['', 'RS-002', 'Laptop 2', 'Laptops', '', 'Rs 44,000/-', ''],
          ['', 'RS-003', 'Laptop 3', 'Laptops', '', 'INR 44000', ''],
          ['', 'RS-004', 'Laptop 4', 'Laptops', '', '₹1,14,900.00', ''],
          ['', 'RS-005', 'Laptop 5', 'Laptops', '', 'Rs. 1,14,900.00 /-', ''],
          ['', 'RS-006', 'Laptop 6', 'Laptops', '', '44000/-', 'no currency named'],
          ['', 'RS-007', 'Laptop 7', 'Laptops', '', 'donated', ''],
        ]),
      'utf8',
    ),
  /** Cells holding the delimiter, doubled quotes and line breaks; a bare inch mark in an unquoted cell. */
  'quoted-fields.csv': () =>
    Buffer.from(
      'Asset Tag,Serial Number,Name,Category,Notes\r\n' +
        ',Q-001,"Dell, Latitude 5440",Laptops,"comma, inside"\r\n' +
        ',Q-002,"The ""big"" one",Laptops,"He said ""hi"", then left"\r\n' +
        ',Q-003,Monitor 27",Monitors,"line one\r\nline two, with comma\r\n""line three"""\r\n' +
        ',Q-004,"",Monitors,""\r\n',
      'utf8',
    ),
  /** The bad case: a quote that is never closed. The file is refused with the line it starts on. */
  'unclosed-quote.csv': () =>
    Buffer.from(
      'Serial Number,Name,Category\r\nUQ-1,Fine,Laptops\r\nUQ-2,"Never closed,Laptops\r\nUQ-3,Lost,Laptops\r\n',
      'utf8',
    ),

  // ---- structure
  /** A title line, a blank line and a merged group row (exported as text in the first cell of each span). */
  'title-rows.csv': () =>
    Buffer.from(
      delimited([
        ['Asset register - Head office', '', '', '', '', '', ''],
        ['Exported 2025-12-31 by IT', '', '', '', '', '', ''],
        ['', '', '', '', '', '', ''],
        ['Identity', '', '', '', 'Purchase', '', ''],
        H,
        ['', 'TR-001', 'Laptop 1', 'Laptops', '2025-02-01', '800', ''],
        ['', 'TR-002', 'Laptop 2', 'Laptops', '2025-02-02', '900', ''],
      ]),
      'utf8',
    ),
  /** The same in a workbook: the title and group rows are merged cells above the header (row 4). */
  'merged-header.xlsx': () =>
    xlsx([
      {
        name: 'Register',
        rows: [
          ['Asset register 2025'],
          [],
          ['Identity', null, null, 'Purchase', null, null, 'Other'],
          H,
          [null, 'MX-001', 'Laptop 1', 'Laptops', { n: 45689, s: 1 }, { n: 800, s: 4 }, null],
          [null, 'MX-002', 'Laptop 2', 'Laptops', { n: 45690, s: 1 }, { n: 950.5, s: 4 }, 'spare'],
        ],
        merges: ['A1:G1', 'A3:C3', 'D3:F3'],
      },
    ]),
  /** Empty columns to the right (some with blank headers) and empty rows at the end, as Excel leaves them. */
  'trailing-empty.csv': () =>
    Buffer.from(
      'Asset Tag,Serial Number,Name,Category,,,\r\n' +
        ',TE-001,One,Laptops,,,\r\n' +
        ',TE-002,Two,Laptops,,,\r\n' +
        '\r\n' +
        ',,,,,,\r\n' +
        ',TE-003,Three after a blank row,Laptops,,,\r\n' +
        ',,,,,,\r\n' +
        ',,,,,,\r\n' +
        '   ,  ,,,,,\r\n' +
        '\r\n',
      'utf8',
    ),
  /** Header names with stray spaces, odd case and punctuation; the suggested mapping must not care. */
  'header-variants.csv': () =>
    Buffer.from(
      '  ASSET tag ,serial   NUMBER, name,CATEGORY  ,Purchase  Date,"Cost ",notes\r\n' +
        ',HV-001,Laptop,Laptops,2025-04-01,500,\r\n',
      'utf8',
    ),

  // ---- data problems
  /** Repeated serials and tags inside the file (case and padding differ) and against existing assets. */
  'duplicates.csv': () =>
    Buffer.from(
      delimited([
        H,
        ['', 'DUP-001', 'First of a pair', 'Laptops', '', '', ''],
        ['', ' dup-001 ', 'Same serial, other case', 'Laptops', '', '', ''],
        ['DUPTAG-1', 'DUP-002', 'Tagged', 'Laptops', '', '', ''],
        ['duptag-1', 'DUP-003', 'Same tag, other case', 'Laptops', '', '', ''],
        ['', 'EXISTING-SN', 'Serial already in the registry', 'Laptops', '', '', ''],
        ['EXISTING-TAG', 'DUP-004', 'Tag already in the registry', 'Laptops', '', '', ''],
        // ED-35: a new tag whose serial is another asset's is a row error, not a second asset
        ['NEWTAG-1', 'EXISTING-SN2', 'New tag, serial in the registry', 'Laptops', '', '', ''],
        ['', 'DUP-005', 'Unique', 'Laptops', '', '', ''],
      ]),
      'utf8',
    ),
  /** Blank required cells: no category, nothing to tell the row apart, only whitespace. */
  'blank-required.csv': () =>
    Buffer.from(
      delimited([
        H,
        ['', 'BR-001', 'Has everything', 'Laptops', '', '', ''],
        ['', 'BR-002', 'No category', '', '', '', ''],
        ['', '', '', 'Laptops', '', '', 'no tag, serial or name'],
        ['', '', '', '', '', '', '   '],
        ['', 'BR-003', '  ', '  Laptops  ', '', '', ''],
      ]),
      'utf8',
    ),
  /** Values over the field limits (serial and name 200, tag 64, notes 10,000): 201, 256, 101, 10,001. */
  'too-long.csv': () =>
    Buffer.from(
      delimited([
        H,
        ['', 'TL-001', 'Fits', 'Laptops', '', '', ''],
        ['', `TL-${'9'.repeat(198)}`, 'Serial too long', 'Laptops', '', '', ''],
        ['', 'TL-003', 'N'.repeat(256), 'Laptops', '', '', ''],
        ['T'.repeat(101), 'TL-004', 'Tag too long', 'Laptops', '', '', ''],
        ['', 'TL-005', 'Notes too long', 'Laptops', '', '', 'x'.repeat(10_001)],
      ]),
      'utf8',
    ),
  /** One cell larger than the reader's 32,000-character cap: the whole file is refused with the line. */
  'cell-over-limit.csv': () =>
    Buffer.from(
      `Serial Number,Name,Category\r\nCL-1,ok,Laptops\r\nCL-2,"${'y'.repeat(32_001)}",Laptops\r\n`,
      'utf8',
    ),

  // ---- workbook cell types
  /**
   * A hidden lookup sheet first, the data on the second sheet, a third visible sheet. Dates as styled
   * serial numbers (built-in and custom formats) and as a General number; numbers stored as text; a
   * formula with a cached number, one with a cached text, one with an error; a leading-zero serial kept
   * as text; a long serial typed as a number.
   */
  'cell-types.xlsx': () =>
    xlsx([
      { name: 'Lookup', hidden: true, rows: [['Category'], ['Laptops'], ['Monitors']] },
      {
        name: 'Assets',
        rows: [
          [...H, 'Warranty End'],
          // styled dates (m/d/yyyy and dd.mm.yyyy), a plain number cost
          [
            null,
            'CT-001',
            'Styled dates',
            'Laptops',
            { n: 45658, s: 1 },
            { n: 1249.5 },
            null,
            { n: 46752, s: 2 },
          ],
          // numbers and dates stored as text (Excel's green triangle)
          [
            null,
            'CT-002',
            'Text numbers',
            'Laptops',
            '2025-01-02',
            { inline: '1249.50' },
            null,
            '31.12.2027',
          ],
          // formulas: the cached values are what is read
          [
            null,
            { f: 'CONCAT("CT-","003")', v: 'CT-003', t: 'str' },
            'Formulas',
            'Laptops',
            { n: 45660, s: 1 },
            { f: 'F3*2', v: '2499' },
            null,
            null,
          ],
          // a formula that evaluates to an error: a clear row error, not a crash
          [
            null,
            'CT-004',
            'Error cell',
            'Laptops',
            null,
            { f: '1/0', v: '#DIV/0!', t: 'e' },
            null,
            null,
          ],
          // a date typed as a General number: not a date to the importer (a row error that says so)
          [null, 'CT-005', 'Unstyled date', 'Laptops', { n: 45661 }, null, null, null],
          // a serial with leading zeros (text) and a long numeric serial (a number cell)
          [null, '000123', 'Leading zeros', 'Laptops', null, null, null, null],
          [null, { n: 123456789012 }, 'Numeric serial', 'Laptops', null, null, { n: 1 }, null],
        ],
      },
      { name: 'Notes', rows: [['Read me'], ['This sheet is not the data.']] },
    ]),

  // ---- formula injection
  /**
   * Cells a spreadsheet would run as formulas (OWASP "CSV injection"): `=`, `+`, `-`, `@`, a leading tab,
   * an already guarded `'=`, a formula header, and a formula in the cost (a number field).
   */
  'formula-injection.csv': () =>
    Buffer.from(
      delimited([
        [
          'Asset Tag',
          'Serial Number',
          'Name',
          'Category',
          'Cost',
          'Notes',
          '=HYPERLINK("http://evil")',
        ],
        ['', 'FI-001', '=1+1', 'Laptops', '', '+SUM(A1:A9)', ''],
        ['', 'FI-002', '-2+3', 'Laptops', '', '@cmd', ''],
        ['', 'FI-003', "\t=cmd|'/c calc'!A1", 'Laptops', '', "'=already guarded", ''],
        ['', 'FI-004', 'Formula cost', 'Laptops', '=1+1', '=HYPERLINK("http://evil","x")', 'x'],
        ['', '=FI-005', '@SUM(1)', '=cmd', '', '', ''],
      ]),
      'utf8',
    ),
};

// ------------------------------------------------------------------------------------ the scale file

/** Header of the scale file: what a European spreadsheet calls the asset columns. */
export const MESSY_HEADERS = [
  'Asset Tag',
  ' Serial Number ',
  'Name',
  'Category',
  'Manufacturer',
  'Status',
  'Location',
  'Purchase Date',
  'Cost',
  'Notes',
  '',
];

/** What `messyAssetCsv(rows)` should produce at dry run: counts by outcome. */
export function messyExpectation(rows: number): {
  create: number;
  skip: number;
  error: number;
} {
  let skip = 0;
  let error = 0;
  for (let i = 0; i < rows; i++) {
    if (i % 100 === 50) skip++;
    else if (i % 100 === 7) error++;
  }
  return { create: rows - skip - error, skip, error };
}

/**
 * A large semicolon-delimited UTF-8 file with a BOM and the messes of the corpus mixed in: a title line
 * above the header, a blank trailing column, European decimals and day-first dates, quoted notes with
 * semicolons and line breaks, accented names, formula-looking notes, every 100th row (offset 50) a
 * duplicate of the row before by serial (other case), every 100th (offset 7) an error (a date that does
 * not exist), and empty lines. Deterministic: the same `rows` gives the same bytes.
 */
export function messyAssetCsv(rows: number, prefix = 'MS'): Buffer {
  const names = ['Portátil', 'Écran', 'Übersicht', 'Niño', 'Smørrebrød', 'Ålesund'];
  const lines: string[][] = [
    ['Inventar Export', '', '', '', '', '', '', '', '', '', ''],
    MESSY_HEADERS,
  ];
  for (let i = 0; i < rows; i++) {
    const serial =
      i % 100 === 50
        ? `${prefix}-${String(i - 1).padStart(7, '0')}`.toLowerCase()
        : `${prefix}-${String(i).padStart(7, '0')}`;
    const day = 1 + (i % 28);
    const month = 1 + (i % 12);
    const date =
      i % 100 === 7
        ? `31.02.2024`
        : i % 2 === 0
          ? `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.2024`
          : `${day}/${month}/2024`;
    const euros = 100 + (i % 900);
    const cents = String(i % 100).padStart(2, '0');
    lines.push([
      '',
      serial,
      `${names[i % names.length]} ${i}`,
      `Kategorie ${i % 6}`,
      `Hersteller ${i % 4}`,
      'Ready to deploy',
      `Standort ${i % 5} > Raum ${i % 20}`,
      date,
      i % 3 === 0 ? `1.${String(euros).padStart(3, '0')},${cents}` : `${euros},${cents}`,
      i % 50 === 0 ? `Akku; Netzteil\nzweite Zeile` : i % 333 === 0 ? '=HYPERLINK("x")' : '',
      '',
    ]);
    if (i % 1000 === 999) lines.push(['', '', '', '', '', '', '', '', '', '', '']);
  }
  return Buffer.from(BOM8 + delimited(lines, ';'), 'utf8');
}

// `node corpus.ts <dir>` (Node >= 22.18 strips the types itself) writes the checked-in fixtures
if (process.argv[1]?.endsWith('corpus.ts') && process.argv[2]) {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dir = process.argv[2];
  mkdirSync(dir, { recursive: true });
  for (const [name, build] of Object.entries(CORPUS)) {
    writeFileSync(`${dir}/${name}`, build());
    console.log(`wrote ${dir}/${name}`);
  }
}
