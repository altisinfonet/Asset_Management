import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { PRESETS } from './presets.js';
import { analyseFile } from './analysis.js';
import { FileFormatError } from './csv-reader.js';
import { partialScore, suggestMapping } from './fields.js';
import { type MapContext, checkMapping, mapRow, planColumns, summaryRowText } from './mapper.js';
import { detectHeaderIndex, headerNames } from './reader.js';
import { templateCsv, templateOf, templateXlsx } from './template-files.js';
import { optionsSchema } from './types.js';

const file = (text: string | Buffer) => () =>
  Promise.resolve(Readable.from([typeof text === 'string' ? Buffer.from(text) : text]));
const rows = (...cells: string[][]) => cells.map((c, i) => ({ line: i + 1, cells: c }));

describe('header detection and analysis (M2-IMP-02)', () => {
  it('skips a title line and names blank and repeated headers', () => {
    const head = rows(
      ['Asset register 2024'],
      [],
      ['Tag', 'Serial', 'Serial', ''],
      ['A1', 's1', 's1', 'x'],
    );
    expect(detectHeaderIndex(head.filter((r) => r.cells.length > 0))).toBe(1);
    expect(headerNames(['Tag', 'Serial', 'serial', '', ' Model  name '])).toEqual([
      'Tag',
      'Serial',
      'serial (2)',
      'Column D',
      'Model name',
    ]);
  });

  it('honours an explicit header line and rejects one that is not there', () => {
    const head = rows(['x', 'y'], ['a', 'b'], ['1', '2']);
    expect(detectHeaderIndex(head, 2)).toBe(1);
    expect(() => detectHeaderIndex(head, 9)).toThrow(FileFormatError);
  });

  it('analyses a CSV: header, rows, profile, types, duplicates, blanks, samples and a suggested mapping', async () => {
    const csv =
      'Serial No.;Asset Tag;Purchase Date;Cost;Email\r\n' +
      'SN1;LAP-1;03/04/2024;"1.234,50";a@x.org\r\n' +
      'SN2;LAP-2;25/04/2024;99;b@x.org\r\n' +
      'SN2;;13/04/2024;;\r\n' +
      '\r\n';
    const sunk: unknown[] = [];
    const a = await analyseFile({
      open: file(csv),
      filename: 'devices.csv',
      overrides: {},
      entity: 'asset',
      custom: [],
      maxRows: 100,
      sink: async (r) => void sunk.push(...r),
    });
    expect(a.parse).toMatchObject({ format: 'csv', encoding: 'utf-8', delimiter: ';' });
    expect(a.headers).toEqual(['Serial No.', 'Asset Tag', 'Purchase Date', 'Cost', 'Email']);
    expect(a.rowsTotal).toBe(3);
    expect(sunk).toHaveLength(3);
    const serial = a.profile[0]!;
    expect(serial).toMatchObject({ non_blank: 3, distinct: 2, duplicates: 1, blank: 0 });
    expect(a.profile[1]).toMatchObject({ blank: 1, non_blank: 2 });
    expect(a.profile[2]).toMatchObject({ type: 'date', date_order: 'dmy' });
    expect(a.profile[4]).toMatchObject({ type: 'email' });
    const targets = Object.fromEntries(
      a.mapping.columns.map((c) => [a.headers[c.index], c.target]),
    );
    expect(targets).toMatchObject({
      'Serial No.': 'serial',
      'Asset Tag': 'asset_tag',
      'Purchase Date': 'purchase_date',
      Cost: 'purchase_cost',
      Email: 'assigned_to',
    });
  });

  it('flags a date column that cannot be told apart (both orders possible)', async () => {
    const a = await analyseFile({
      open: file('d\n01/02/2024\n03/04/2024\n'),
      filename: 'x.csv',
      overrides: {},
      entity: 'asset',
      custom: [],
      maxRows: 10,
      sink: async () => undefined,
    });
    expect(a.profile[0]).toMatchObject({ type: 'date', date_order: 'ambiguous' });
  });

  it('refuses an empty file, a header without data and more rows than the quota, with a sentence', async () => {
    const run = (text: string, maxRows = 5) =>
      analyseFile({
        open: file(text),
        filename: 'x.csv',
        overrides: {},
        entity: 'asset',
        custom: [],
        maxRows,
        sink: async () => undefined,
      });
    await expect(run('')).rejects.toThrow(/empty/);
    await expect(run('a,b\n')).rejects.toThrow(/no data rows/);
    await expect(run(`a,b\n${'1,2\n'.repeat(6)}`)).rejects.toThrow(/more than 5 data rows/);
    await expect(run('a,b\n1,"2\n')).rejects.toMatchObject({ line: 2 });
  });

  it('refuses old .xls files and unknown extensions up front', async () => {
    await expect(
      analyseFile({
        open: file('x'),
        filename: 'old.xls',
        overrides: {},
        entity: 'asset',
        custom: [],
        maxRows: 5,
        sink: async () => undefined,
      }),
    ).rejects.toThrow(/\.xlsx/);
    await expect(
      analyseFile({
        open: file('x'),
        filename: 'a.pdf',
        overrides: {},
        entity: 'asset',
        custom: [],
        maxRows: 5,
        sink: async () => undefined,
      }),
    ).rejects.toThrow(/csv and .xlsx/);
  });
});

describe('mapping suggestions (M2-IMP-03)', () => {
  const guess = (entity: 'asset' | 'person' | 'location', headers: string[]) =>
    Object.fromEntries(suggestMapping(entity, headers).map((s) => [s.header, s.target]));

  it('maps synonyms case- and punctuation-insensitively', () => {
    expect(
      guess('asset', [
        'S/N',
        'Service Tag',
        'ASSET_TAG',
        'Make',
        'Product',
        'Cost Centre',
        'Purchased',
        'Comments',
      ]),
    ).toMatchObject({
      'S/N': 'serial',
      ASSET_TAG: 'asset_tag',
      Make: 'manufacturer',
      Product: 'model',
      'Cost Centre': 'department',
      Purchased: 'purchase_date',
      Comments: 'notes',
    });
    // two columns cannot both be the serial number: the best match wins, the other stays unmapped
    const dup = guess('asset', ['S/N', 'Serial Number']);
    expect(Object.values(dup).filter((t) => t === 'serial')).toHaveLength(1);
  });

  it('reads the headers of a messy school register (walk-through BUG-7)', () => {
    expect(
      guess('asset', [
        'Sr No',
        'Tag No.',
        'Item',
        'Serial #',
        'Type',
        'Brand',
        'Model No',
        'Condition',
        'Room',
        'Dept',
        'Date of Purchase',
        'Price (Rs)',
        'Bought From',
        'Remarks',
      ]),
    ).toEqual({
      'Sr No': null,
      'Tag No.': 'asset_tag',
      Item: 'name',
      'Serial #': 'serial',
      Type: 'category',
      Brand: 'manufacturer',
      'Model No': 'model',
      Condition: 'status',
      Room: 'location',
      Dept: 'department',
      'Date of Purchase': 'purchase_date',
      'Price (Rs)': 'purchase_cost',
      'Bought From': 'vendor',
      Remarks: 'notes',
    });
    // "tag no" with and without the full stop, in any case
    expect(guess('asset', ['TAG NO'])).toEqual({ 'TAG NO': 'asset_tag' });
  });

  it('prefers a whole phrase over a single word of a header', () => {
    // "bought" (purchase date) is one word of "Bought From"; "bought from" (vendor) is all of it
    expect(guess('asset', ['Bought From', 'Purchase Dt'])).toMatchObject({
      'Bought From': 'vendor',
    });
    // a header that only contains a synonym as a word still gets it, below an exact header
    expect(guess('asset', ['Supplier Name', 'Supplier'])).toEqual({
      'Supplier Name': null,
      Supplier: 'vendor',
    });
    expect(guess('asset', ['Supplier Name'])).toEqual({ 'Supplier Name': 'vendor' });
    // longer phrases score higher than single words, both below an exact synonym (0.9)
    const words = partialScore('Date of Purchase (dd/mm)', ['purchase date', 'date of purchase']);
    const word = partialScore('Date of Purchase (dd/mm)', ['purchase']);
    expect(words).toBeGreaterThan(word);
    expect(words).toBeLessThan(0.9);
    // short synonyms never match inside other words
    expect(partialScore('Postcode', ['po'])).toBe(0);
  });

  it('matches custom fields by key, label and the export prefix', () => {
    const s = suggestMapping(
      'asset',
      ['cf:os_version', 'Boot Mode'],
      [
        { key: 'os_version', label: 'OS version', dataType: 'text', categoryId: null },
        { key: 'boot_mode', label: 'Boot mode', dataType: 'text', categoryId: null },
      ],
    );
    expect(s.map((x) => x.target)).toEqual(['cf:os_version', 'cf:boot_mode']);
  });

  it('reads the export of locations: its `path` is the parent chain next to `name`', () => {
    expect(guess('location', ['name', 'path', 'kind', 'code'])).toMatchObject({
      name: 'name',
      path: 'parent_path',
      kind: 'kind',
      code: 'code',
    });
    expect(guess('location', ['Path', 'Kind'])).toMatchObject({ Path: 'path' });
  });

  it('flags a mapping that cannot run', () => {
    const none = { defaults: {} } as never;
    expect(
      checkMapping('asset', { columns: [{ index: 0, target: 'serial' }] }, none, new Set(), 3).map(
        (i) => i.field,
      ),
    ).toContain('category');
    expect(
      checkMapping(
        'asset',
        {
          columns: [
            { index: 0, target: 'serial' },
            { index: 1, target: 'serial' },
            { index: 2, target: 'nope' },
            { index: 9, target: null },
          ],
        },
        { defaults: { category: 'x' } } as never,
        new Set(),
        3,
      ).map((i) => i.code),
    ).toEqual(expect.arrayContaining(['duplicate', 'target', 'column']));
    expect(
      checkMapping(
        'person',
        { columns: [{ index: 0, target: 'cf:x' }] },
        none,
        new Set(['x']),
        1,
      ).some((i) => /only be imported into assets/.test(i.message)),
    ).toBe(true);
  });
});

describe('row mapping', () => {
  const ctx = (
    entity: 'asset' | 'person',
    columns: Array<{ index: number; target: string | null }>,
    options: Record<string, unknown> = {},
    constants: Record<string, string> = {},
  ): MapContext => ({
    columns: planColumns(entity, { columns }),
    options: optionsSchema.parse(options),
    baseCurrency: 'USD',
    constants,
  });

  it('types the cells, builds money from cost + currency and applies constants and the formula-guard round trip', () => {
    const c = ctx(
      'asset',
      [
        { index: 0, target: 'serial' },
        { index: 1, target: 'purchase_cost' },
        { index: 2, target: 'currency' },
        { index: 3, target: 'purchase_date' },
        { index: 4, target: 'notes' },
        { index: 5, target: 'model' },
        { index: 6, target: 'cf:os' },
      ],
      { number_format: 'comma', date_format: 'dmy' },
      { category: 'Chromebook' },
    );
    const { record, issues } = mapRow(
      ['  SN1 ', '1.234,5', 'eur', '07/03/2024', "'=cmd", '', '126'],
      c,
    );
    expect(issues).toEqual([]);
    expect(record.f).toMatchObject({
      serial: 'SN1',
      purchase_cost: { amount_minor: 123450, currency: 'EUR' },
      purchase_date: '2024-03-07',
      notes: '=cmd',
    });
    expect(record.r).toEqual({ category: 'Chromebook' });
    expect(record.c).toEqual({ os: '126' });
    expect(record.b).toEqual(['model']);
  });

  it('reports a bad cell on its field and keeps going', () => {
    const c = ctx('asset', [
      { index: 0, target: 'purchase_date' },
      { index: 1, target: 'purchase_cost' },
      { index: 2, target: 'serial' },
    ]);
    const { issues, record } = mapRow(['03/04/2024', 'abc', 'ok'], c);
    expect(issues.map((i) => [i.field, i.code])).toEqual([
      ['purchase_date', 'ambiguous-date'],
      ['purchase_cost', 'number'],
    ]);
    expect(record.f.serial).toBe('ok');
  });

  it('checks enums', () => {
    const c = ctx('person', [{ index: 0, target: 'kind' }]);
    expect(mapRow(['Employee'], c).record.f.kind).toBe('employee');
    expect(mapRow(['alien'], c).issues[0]).toMatchObject({ field: 'kind', code: 'enum' });
  });
});

describe('templates (M2-IMP-07)', () => {
  it('every preset template maps back onto its own targets (header round trip)', () => {
    for (const p of PRESETS) {
      const t = templateOf(p);
      const guessed = Object.fromEntries(
        suggestMapping(p.entity_type, t.headers).map((s) => [s.header, s.target]),
      );
      for (const c of p.columns) {
        if (
          c.target.startsWith('cf:') &&
          p.entity_type === 'asset' &&
          p.key !== 'google_admin_chromeos'
        )
          continue;
        // the Google preset maps by its own table; the generic ones by the heuristic
        if (p.key === 'google_admin_chromeos') continue;
        expect(guessed[c.template ?? c.headers[0]!], `${p.key}: ${c.template}`).toBe(c.target);
      }
      expect(templateCsv(t).toString('utf8').startsWith('﻿')).toBe(true);
      expect(t.rows.every((r) => r.length === t.headers.length)).toBe(true);
    }
  });

  it('adds the custom fields of the tenant to the asset template', () => {
    const t = templateOf(
      PRESETS.find((p) => p.key === 'assets')!,
      ['os', 'mac'],
    );
    expect(t.headers.slice(-2)).toEqual(['cf:os', 'cf:mac']);
    expect(templateXlsx(PRESETS[0]!, t).subarray(0, 2).toString()).toBe('PK');
  });
});

describe('summary lines at the foot of a sheet (ED-36)', () => {
  it('recognises a lone total cell with a number', () => {
    expect(summaryRowText(['', 'TOTAL ITEMS: 120', '', ''])).toBe('TOTAL ITEMS: 120');
    expect(summaryRowText(['Grand total 58,000'])).toBe('Grand total 58,000');
    expect(summaryRowText(['  Sub-total: 12 ', ''])).toBe('Sub-total: 12');
    expect(summaryRowText(['Count = 4'])).toBe('Count = 4');
  });

  it('leaves real rows alone', () => {
    // more than one filled cell, no number, or not a total word at the start
    expect(summaryRowText(['TOTAL-001', 'Laptops'])).toBeNull();
    expect(summaryRowText(['Total'])).toBeNull();
    expect(summaryRowText(['LAP-0042'])).toBeNull();
    expect(summaryRowText(['Totally new laptop 2'])).toBeNull();
    expect(summaryRowText(['', '', ''])).toBeNull();
  });
});
