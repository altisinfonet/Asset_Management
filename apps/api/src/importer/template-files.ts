import { zipSync, strToU8 } from 'fflate';
import { CsvWriter } from '../exports/index.js';
import { type Preset, dictionary } from './presets.js';

/**
 * Downloadable templates (M2-IMP-07): a CSV or an XLSX with the header row of a preset, example rows and
 * (XLSX) a second sheet with the data dictionary. The CSV is UTF-8 with a byte order mark and CRLF, like the
 * exports, and goes through the same formula guard. The XLSX is written by hand (strings are inline, no shared
 * string table or styles needed) and read back by the importer's own reader in the tests.
 */

export interface TemplateColumn {
  header: string;
  /** `cf:<key>` columns the tenant's custom fields add to an asset template. */
}

export interface TemplateContent {
  headers: string[];
  rows: string[][];
}

/** The template of a preset, with the tenant's custom fields appended for assets. */
export function templateOf(preset: Preset, customKeys: readonly string[] = []): TemplateContent {
  const headers = preset.columns.map((c) => c.template ?? c.headers[0]!);
  const extra =
    preset.entity_type === 'asset' && !preset.constants
      ? customKeys
          .filter((k) => !preset.columns.some((c) => c.target === `cf:${k}`))
          .map((k) => `cf:${k}`)
      : [];
  return {
    headers: [...headers, ...extra],
    rows: preset.examples.map((r) => [...r, ...extra.map(() => '')]),
  };
}

export function templateCsv(content: TemplateContent): Buffer {
  const csv = new CsvWriter(content.headers);
  for (const r of content.rows) csv.add(r);
  return csv.toBuffer();
}

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

function colName(i: number): string {
  let n = i + 1;
  let out = '';
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function sheetXml(rows: string[][]): string {
  const body = rows
    .map((cells, r) => {
      const cs = cells
        .map((v, c) =>
          v === ''
            ? ''
            : `<c r="${colName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`,
        )
        .join('');
      return `<row r="${r + 1}">${cs}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** An XLSX workbook: the template sheet first, then the data dictionary. */
export function templateXlsx(preset: Preset, content: TemplateContent): Buffer {
  const dict = dictionary(preset);
  const dictRows = [
    ['Column', 'Maps to', 'Description', 'Required', 'Example'],
    ...dict.map((d) => [d.column, d.target, d.description, d.required, d.example]),
  ];
  const notes = preset.notes.map((n) => ['', '', n, '', '']);
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Template" sheetId="1" r:id="rId1"/><sheet name="Data dictionary" sheetId="2" r:id="rId2"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml([content.headers, ...content.rows])),
    'xl/worksheets/sheet2.xml': strToU8(sheetXml([...dictRows, [''], ...notes])),
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}
