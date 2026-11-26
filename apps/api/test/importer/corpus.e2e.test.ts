import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExportRunner } from '../../src/exports/index.js';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import { CORPUS } from './corpus.js';
import {
  type ImportHarness,
  type Json,
  type TenantFixture,
  allRows,
  analyzed,
  commit,
  contractViolations,
  createTenant,
  dryRun,
  newTenancy,
  ownerTenantSql,
  registryCounts,
  startImportApp,
} from './support.js';

const DIR = join(import.meta.dirname, 'fixtures', 'corpus');
const fixture = (name: string): Buffer => readFileSync(join(DIR, name));

/** Splits the error report (RFC 4180, as the API writes it) into rows of cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const t = text.startsWith('﻿') ? text.slice(1) : text;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && t[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell]);
  return rows;
}

/**
 * M2-IMP-09: the messy-file corpus (`fixtures/corpus`, built by `corpus.ts`). Every fixture goes through
 * the real pipeline: upload (attachment, content sniffing), analysis, the suggested mapping, dry run and,
 * where rows are valid, commit; the test pins either the parsed values of the created assets or the code
 * and message of the row error (or the sentence of a refused file). Nothing ends in a 500 or a silent drop.
 */
describe.skipIf(!dbEnabled)(`import corpus (${mode})`, () => {
  const tenancy = newTenancy();
  let ih: ImportHarness;
  let t: TenantFixture;
  const admin = () => t.admin;

  beforeAll(async () => {
    ih = await startImportApp();
    t = await createTenant(ih.h.app, tenancy, 'corpus');
  });
  afterAll(async () => {
    await ih.h.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  /** Uploads and analyses a corpus file. */
  const analyse = (
    name: string,
    create: Record<string, unknown> = {},
    parse?: Record<string, unknown>,
    filename = name,
  ) => analyzed(ih, admin(), t.tenantId, 'asset', { filename, body: fixture(name) }, create, parse);

  /** Dry run, then the rows with their verdicts. */
  async function dry(job: Json): Promise<{ done: Json; rows: Json[] }> {
    const done = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(done.state, done.error ?? '').toBe('dry_run_done');
    return { done, rows: await allRows(admin(), job.id) };
  }

  /** Commit, then the created assets in row order (`null` for rows that created nothing). */
  async function commitAll(done: Json): Promise<{ job: Json; assets: Array<Json | null> }> {
    const job = await commit(ih, admin(), t.tenantId, done.id, done.dry_run_digest);
    expect(job.state, job.error ?? '').toBe('completed');
    const rows = await allRows(admin(), done.id);
    const assets: Array<Json | null> = [];
    for (const r of rows) {
      if (!r.created_id) assets.push(null);
      else {
        const res = await admin().get(`/v1/assets/${r.created_id}?expand=category,location`);
        expect(res.status).toBe(200);
        assets.push(res.body);
      }
    }
    return { job, assets };
  }

  const targetsOf = (job: Json): Record<string, string | null> =>
    Object.fromEntries(job.mapping.columns.map((c: Json) => [job.headers[c.index], c.target]));
  const codes = (r: Json): string[] => r.errors.map((e: Json) => e.code);

  it('the checked-in fixtures are exactly what corpus.ts builds (no line-ending or encoding drift)', () => {
    for (const [name, build] of Object.entries(CORPUS)) {
      expect(fixture(name).equals(build()), `${name} differs from corpus.ts`).toBe(true);
    }
  });

  // ------------------------------------------------------------------------- encodings, line endings

  it('UTF-8 with a BOM: the BOM is not part of the first header, accents, euro and CJK survive', async () => {
    const job = await analyse('utf8-bom.csv');
    expect(job.parse).toMatchObject({ format: 'csv', encoding: 'utf-8', delimiter: ',' });
    expect(job.headers[0]).toBe('Asset Tag');
    expect(targetsOf(job)).toMatchObject({ 'Asset Tag': 'asset_tag', 'Serial Number': 'serial' });
    const { done, rows } = await dry(job);
    expect(rows.map((r) => r.outcome)).toEqual(['create', 'create', 'create']);
    const { assets } = await commitAll(done);
    expect(assets.map((a) => [a!.serial, a!.name, a!.notes, a!.purchase_cost])).toEqual([
      ['U8-001', 'Portátil de José', 'Zoë’s spare', { amount_minor: 124900, currency: 'USD' }],
      ['U8-002', 'Müller Überwachung', 'Niño', { amount_minor: 34990, currency: 'EUR' }],
      ['U8-003', '東京オフィス', null, { amount_minor: 19900, currency: 'USD' }],
    ]);
  });

  it('UTF-16 LE "Unicode text": refused as .txt at upload with a sentence, imported when named .csv', async () => {
    // the upload allow-list takes .csv and .xlsx only (the wizard's file picker too): logged as M2-IMP-10
    const created = await admin().post('/v1/imports', { entity_type: 'asset' });
    const refused = await admin().post('/v1/attachments', {
      entity_type: 'import_job',
      entity_id: created.body.id,
      kind: 'import_file',
      filename: 'utf16le-unicode-text.txt',
      content_type: 'text/csv',
      size_bytes: fixture('utf16le-unicode-text.txt').length,
    });
    expect(refused.status).toBe(415);
    expect(refused.body.code).toBe('unsupported-media-type');
    expect(refused.body.detail).toMatch(/extension "txt"/);

    const job = await analyse('utf16le-unicode-text.txt', {}, undefined, 'unicode-text.csv');
    expect(job.parse).toMatchObject({ encoding: 'utf-16le', delimiter: '\t' });
    expect(job.headers[0]).toBe('Asset Tag');
    const { done, rows } = await dry(job);
    expect(rows.map((r) => r.outcome)).toEqual(['create', 'create', 'create']);
    const { assets } = await commitAll(done);
    expect(assets.map((a) => [a!.serial, a!.name, a!.notes])).toEqual([
      ['U16-001', 'François Dupré', 'Łódź office'],
      ['U16-002', 'Ærø Søndergård', 'a "quoted" word'],
      ['U16-003', 'Ελληνικά', 'tab\tinside'],
    ]);
    expect(assets[0]!.purchase_cost).toEqual({ amount_minor: 124950, currency: 'USD' });
    expect(assets[1]!.purchase_cost).toEqual({ amount_minor: 9900, currency: 'EUR' });
  });

  it('Windows-1252 without a BOM: é, ü, ñ, smart quotes and € decode to the right characters', async () => {
    const job = await analyse('windows-1252.csv');
    expect(job.parse).toMatchObject({ encoding: 'windows-1252', delimiter: ',' });
    const { done } = await dry(job);
    const { assets } = await commitAll(done);
    expect(assets.map((a) => [a!.name, a!.notes, a!.purchase_cost])).toEqual([
      ['Café Zürich', '“Señor Núñez” – Büro', { amount_minor: 89900, currency: 'EUR' }],
      ['Señora Muñoz', 'Ångström', { amount_minor: 109900, currency: 'EUR' }],
      ['Ü-Wagen', '½ price', null],
    ]);
  });

  it('mixed CRLF, LF and lone CR line endings: four records, the right line numbers, line breaks kept', async () => {
    const job = await analyse('mixed-line-endings.csv');
    expect(job.rows_total).toBe(4);
    const { done, rows } = await dry(job);
    expect(rows.map((r) => r.line_no)).toEqual([2, 3, 4, 7]);
    const { assets } = await commitAll(done);
    expect(assets.map((a) => [a!.serial, a!.notes])).toEqual([
      ['ML-001', 'crlf'],
      ['ML-002', 'lf'],
      ['ML-003', 'first line\nsecond line\nthird line'],
      ['ML-004', 'after a lone CR'],
    ]);
  });

  // ------------------------------------------------------------------------------ delimiters, quoting

  it('semicolons, European decimals and day-first dates (the column proves the order)', async () => {
    const job = await analyse('semicolon-european.csv');
    expect(job.parse).toMatchObject({ delimiter: ';' });
    const cols = Object.fromEntries(job.mapping.columns.map((c: Json) => [c.target, c]));
    expect(cols.purchase_date.date_format).toBe('dmy');
    expect(cols.warranty_end.date_format).toBe('dmy');
    const { done, rows } = await dry(job);
    expect(rows.map((r) => r.outcome)).toEqual(Array(6).fill('create'));
    const { assets } = await commitAll(done);
    expect(
      assets.map((a) => [
        a!.purchase_date,
        a!.purchase_cost?.amount_minor ?? null,
        a!.warranty_end,
      ]),
    ).toEqual([
      ['2025-12-31', 123456, '2027-12-31'],
      ['2025-02-01', 99990, '2027-02-01'],
      ['2024-06-15', 1200000, '2026-06-15'],
      ['2024-03-05', 129900, '2026-03-05'],
      ['2024-11-30', 99, null],
      // documented `auto` behaviour: `12,500` is twelve thousand five hundred (one comma, three digits)
      [null, 1250000, null],
    ]);
    expect(assets[3]!.purchase_cost.currency).toBe('EUR');
    expect(assets[3]!.notes).toBe('a; b');

    // the file's own convention, stated: `number_format: comma` reads `12,500` as 12.5
    const again = await analyse('semicolon-european.csv', {
      options: { number_format: 'comma', match_on: 'serial', on_match: 'update' },
    });
    const re = await dry(again);
    expect(re.rows.map((r) => r.outcome)).toEqual([
      'skip',
      'skip',
      'skip',
      'skip',
      'skip',
      'update',
    ]);
    const { assets: updated } = await commitAll(re.done);
    expect(updated.every((a) => a === null)).toBe(true);
    const f = await admin().get('/v1/assets?serial=EU-006');
    expect(f.body.data[0].purchase_cost).toEqual({ amount_minor: 1250, currency: 'USD' });
  });

  it('quoted fields with delimiters, doubled quotes and line breaks; a bare inch mark is kept', async () => {
    const job = await analyse('quoted-fields.csv');
    expect(job.rows_total).toBe(4);
    const { done, rows } = await dry(job);
    expect(rows.map((r) => r.outcome)).toEqual(['create', 'create', 'create', 'create']);
    const { assets } = await commitAll(done);
    expect(assets.map((a) => [a!.name, a!.notes])).toEqual([
      ['Dell, Latitude 5440', 'comma, inside'],
      ['The "big" one', 'He said "hi", then left'],
      ['Monitor 27"', 'line one\nline two, with comma\n"line three"'],
      [null, null],
    ]);
  });

  it('an unclosed quote fails the analysis with the line it starts on, not a stack trace', async () => {
    const job = await analyse('unclosed-quote.csv');
    expect(job.state).toBe('failed');
    expect(job.error).toBe('Line 3: a quoted field is never closed (missing closing quote).');
  });

  // ------------------------------------------------------------------------------------- structure

  it('title, blank and group rows above the header are passed over', async () => {
    const job = await analyse('title-rows.csv');
    expect(job.parse.header_line).toBe(5);
    expect(job.headers.slice(0, 7)).toEqual(
      expect.arrayContaining(['Asset Tag', 'Serial Number', 'Purchase Date']),
    );
    expect(job.rows_total).toBe(2);
    const { done } = await dry(job);
    const { assets } = await commitAll(done);
    expect(assets.map((a) => [a!.serial, a!.purchase_date])).toEqual([
      ['TR-001', '2025-02-01'],
      ['TR-002', '2025-02-02'],
    ]);
  });

  it('XLSX with merged title and group cells above the header; styled dates and numbers', async () => {
    const job = await analyse('merged-header.xlsx');
    expect(job.parse).toMatchObject({ format: 'xlsx', sheet: 'Register', header_line: 4 });
    expect(job.rows_total).toBe(2);
    const { done } = await dry(job);
    const { assets } = await commitAll(done);
    expect(
      assets.map((a) => [a!.serial, a!.purchase_date, a!.purchase_cost?.amount_minor]),
    ).toEqual([
      ['MX-001', '2025-02-01', 80000],
      ['MX-002', '2025-02-02', 95050],
    ]);
    expect(assets[1]!.notes).toBe('spare');
  });

  it('empty trailing columns and rows: blank headers are named, empty rows are not data', async () => {
    const job = await analyse('trailing-empty.csv');
    expect(job.headers).toEqual([
      'Asset Tag',
      'Serial Number',
      'Name',
      'Category',
      'Column E',
      'Column F',
      'Column G',
    ]);
    expect(targetsOf(job)).toMatchObject({ 'Column E': null, 'Column F': null, 'Column G': null });
    expect(job.rows_total).toBe(3);
    const { done, rows } = await dry(job);
    expect(rows.map((r) => [r.line_no, r.outcome])).toEqual([
      [2, 'create'],
      [3, 'create'],
      [6, 'create'],
    ]);
    await commitAll(done);
  });

  it('header names with stray spaces and odd case map like the clean ones', async () => {
    const job = await analyse('header-variants.csv');
    expect(job.headers).toEqual([
      'ASSET tag',
      'serial NUMBER',
      'name',
      'CATEGORY',
      'Purchase Date',
      'Cost',
      'notes',
    ]);
    expect(Object.values(targetsOf(job))).toEqual([
      'asset_tag',
      'serial',
      'name',
      'category',
      'purchase_date',
      'purchase_cost',
      'notes',
    ]);
    const { done } = await dry(job);
    const { assets } = await commitAll(done);
    expect(assets[0]).toMatchObject({ serial: 'HV-001', purchase_date: '2025-04-01' });
  });

  // --------------------------------------------------------------------------------- data problems

  it('duplicate serials and tags inside the file and against the registry', async () => {
    const cat = await admin().post('/v1/categories', { name: 'Existing kit' });
    expect(cat.status).toBe(201);
    for (const body of [
      { serial: 'EXISTING-SN' },
      { asset_tag: 'EXISTING-TAG' },
      { serial: 'EXISTING-SN2' },
    ]) {
      const res = await admin().post('/v1/assets', { category_id: cat.body.id, ...body });
      expect(res.status, res.raw).toBe(201);
    }
    // default options: match by tag, else serial; a match is skipped
    const job = await analyse('duplicates.csv');
    const before = await registryCounts(t.tenantId);
    const { done, rows } = await dry(job);
    expect(await registryCounts(t.tenantId)).toEqual(before);
    const verdicts = rows.map((r) => [
      r.outcome,
      [...codes(r), ...r.warnings.map((w: Json) => w.code)].join(','),
    ]);
    expect(verdicts).toEqual([
      ['create', ''],
      ['skip', 'duplicate-in-file'],
      ['create', ''],
      ['skip', 'duplicate-in-file'],
      ['skip', expect.any(String)],
      ['skip', expect.any(String)],
      ['error', 'serial-taken'],
      ['create', ''],
    ]);
    expect(rows[1]!.duplicate_of).toBe(1);
    expect(rows[3]!.duplicate_of).toBe(3);
    // ED-35 (walk-through BUG-6): "tag, else serial" with a new tag and a serial the registry has
    const existing = (await admin().get('/v1/assets?serial=EXISTING-SN2')).body.data[0];
    expect(rows[6]!.errors[0]).toMatchObject({
      field: 'serial',
      code: 'serial-taken',
      message: `Serial number EXISTING-SN2 is already used by ${existing.asset_tag}.`,
    });
    // with no tag the same registry serial is a match, not an error (row 5 is skipped as existing)
    expect(rows[4]!.warnings.map((w: Json) => w.code)).toContain('exists');

    // on_match error: the registry matches become row errors with a code and a message
    const strict = await analyse('duplicates.csv', { options: { on_match: 'error' } });
    const s = await dry(strict);
    for (const r of [s.rows[4]!, s.rows[5]!]) {
      expect(r.outcome).toBe('error');
      expect(r.errors[0].message).toMatch(/already/i);
    }
    const { job: finished } = await commitAll(done);
    expect(finished.counts.commit).toMatchObject({ created: 3, skipped: 4, error: 1 });
    // the commit did not create a second asset with that serial
    expect((await admin().get('/v1/assets?serial=EXISTING-SN2')).body.data).toHaveLength(1);
  });

  it('blank required fields are row errors that name the field', async () => {
    const job = await analyse('blank-required.csv');
    // the whitespace-only row is no data row at all
    expect(job.rows_total).toBe(4);
    const { done, rows } = await dry(job);
    // a row with only a category is a valid asset: the API numbers its tag (as POST /v1/assets would)
    expect(rows.map((r) => r.outcome)).toEqual(['create', 'error', 'create', 'create']);
    expect(rows[1]!.errors).toEqual([
      expect.objectContaining({ field: 'category', code: expect.any(String) }),
    ]);
    expect(rows[1]!.errors[0].message).toMatch(/category/i);
    const { assets } = await commitAll(done);
    expect(assets[2]!.asset_tag).toMatch(/\d+$/);
    expect(assets[2]!.notes).toBe('no tag, serial or name');
    expect(assets[3]).toMatchObject({ serial: 'BR-003', name: null });
    expect(assets[3]!.expanded.category.name).toBe('Laptops');
  });

  it('values over the field limits are row errors (code and message), the rest imports', async () => {
    const job = await analyse('too-long.csv');
    const { done, rows } = await dry(job);
    expect(rows.map((r) => r.outcome)).toEqual(['create', 'error', 'error', 'error', 'error']);
    const fields = rows.slice(1).map((r) => r.errors.map((e: Json) => e.field));
    expect(fields).toEqual([['serial'], ['name'], ['asset_tag'], ['notes']]);
    for (const r of rows.slice(1)) {
      expect(r.errors[0].code).toBe('too_big');
    }
    expect(rows.slice(1).map((r) => r.errors[0].message)).toEqual([
      'Too long: at most 200 characters.',
      'Too long: at most 200 characters.',
      'Too long: at most 64 characters.',
      'Too long: at most 10,000 characters.',
    ]);
    const { job: finished } = await commitAll(done);
    expect(finished.counts.commit).toMatchObject({ created: 1, error: 4 });
  });

  it('a cell over the reader cap fails the file with the line and the limit', async () => {
    const job = await analyse('cell-over-limit.csv');
    expect(job.state).toBe('failed');
    expect(job.error).toBe('Line 3: a cell is longer than 32,000 characters.');
  });

  // ------------------------------------------------------------------------------ workbook cell types

  it('XLSX cell types: styled serial dates, text numbers, formulas, errors, hidden and extra sheets', async () => {
    const job = await analyse('cell-types.xlsx');
    expect(job.parse).toMatchObject({
      format: 'xlsx',
      sheet: 'Assets',
      sheets: ['Assets', 'Notes'],
    });
    expect(job.rows_total).toBe(7);
    const { done, rows } = await dry(job);
    expect(rows.map((r) => [r.outcome, codes(r).join(',')])).toEqual([
      ['create', ''],
      ['create', ''],
      ['create', ''],
      ['error', 'number'],
      ['error', 'date'],
      ['create', ''],
      ['create', ''],
    ]);
    expect(rows[3]!.errors[0]).toMatchObject({ field: 'purchase_cost' });
    expect(rows[3]!.errors[0].message).toContain('#DIV/0!');
    expect(rows[4]!.errors[0]).toMatchObject({ field: 'purchase_date' });
    const { assets } = await commitAll(done);
    const view = assets.map((a) =>
      a ? [a.serial, a.purchase_date, a.purchase_cost?.amount_minor ?? null, a.warranty_end] : null,
    );
    expect(view).toEqual([
      ['CT-001', '2025-01-01', 124950, '2027-12-31'],
      ['CT-002', '2025-01-02', 124950, '2027-12-31'],
      ['CT-003', '2025-01-03', 249900, null],
      null,
      null,
      ['000123', null, null, null],
      ['123456789012', null, null, null],
    ]);

    // the third (visible) sheet can be chosen; the hidden one is still readable by name
    const notes = await analyse('cell-types.xlsx', {}, { sheet: 'Notes' });
    expect(notes).toMatchObject({ state: 'analyzed', rows_total: 1 });
    const hidden = await analyse('cell-types.xlsx', {}, { sheet: 'Lookup' });
    expect(hidden).toMatchObject({ state: 'analyzed', rows_total: 2 });
  });

  // ----------------------------------------------------------------------------- formula injection

  it('formula-looking cells: stored as text, guarded in the error report and in the export', async () => {
    const job = await analyse('formula-injection.csv');
    const { done, rows } = await dry(job);
    expect(rows.map((r) => r.outcome)).toEqual(['create', 'create', 'create', 'error', 'create']);
    expect(rows[3]!.errors[0]).toMatchObject({ field: 'purchase_cost', code: 'number' });

    // the error report: every cell a spreadsheet would run is prefixed with an apostrophe
    const report = await admin().get(`/v1/imports/${job.id}/errors.csv`);
    expect(report.status).toBe(200);
    const table = parseCsv(report.raw);
    expect(table[0]!.at(-1)).toBe(`'=HYPERLINK("http://evil")`);
    expect(table).toHaveLength(2);
    expect(table[1]!.slice(5)).toEqual([
      '',
      'FI-004',
      'Formula cost',
      'Laptops',
      "'=1+1",
      `'=HYPERLINK("http://evil","x")`,
      'x',
    ]);
    for (const r of table) {
      for (const c of r) expect(c, `unguarded cell ${c}`).not.toMatch(/^[=+\-@\t\r]/);
    }

    // the import keeps the text as typed (an apostrophe guard is removed, nothing else)
    const { assets } = await commitAll(done);
    expect(assets.map((a) => (a ? [a.serial, a.name, a.notes] : null))).toEqual([
      ['FI-001', '=1+1', '+SUM(A1:A9)'],
      ['FI-002', '-2+3', '@cmd'],
      ['FI-003', "=cmd|'/c calc'!A1", '=already guarded'],
      null,
      ['=FI-005', '@SUM(1)', null],
    ]);
    expect(assets[4]!.expanded.category.name).toBe('=cmd');

    // and the export of those assets neutralises them again
    const exp = await admin().post('/v1/exports', {
      resource: 'assets',
      filters: { q: 'FI-' },
    });
    expect(exp.status, exp.raw).toBe(202);
    const runner = ih.h.app.get(ExportRunner, { strict: false });
    await ih.runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
      runner.run(
        { tenantId: t.tenantId, exportId: exp.body.id },
        {
          tenantId: t.tenantId,
          tx: tx as never,
          jobId: 'job-1',
          queue: 'export.run',
          retryCount: 0,
          logger: pino({ level: 'silent' }),
        },
      ),
    );
    const key = (
      await ownerTenantSql(t.tenantId, 'select storage_key from app.export_job where id = $1', [
        exp.body.id,
      ])
    ).rows[0]!.storage_key as string;
    const chunks: Buffer[] = [];
    for await (const c of await ih.h.storage.read(key)) chunks.push(c as Buffer);
    const exported = parseCsv(Buffer.concat(chunks).toString('utf8'));
    const header = exported[0]!;
    const names = exported.slice(1).map((r) => r[header.indexOf('name')]);
    expect(names.sort()).toEqual(["'-2+3", "'=1+1", "'@SUM(1)", `'=cmd|'/c calc'!A1`].sort());
    for (const r of exported) {
      for (const c of r) expect(c, `unguarded cell ${c}`).not.toMatch(/^[=+\-@\t\r]/);
    }
  });
});
