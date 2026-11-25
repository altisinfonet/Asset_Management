import { ApiError } from '@assettracker/api-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachmentsApi, putToStorage } from '@/lib/files/api';
import {
  importProblemOf,
  importsApi,
  importTemplatesApi,
  type ImportJob,
  type ImportUpdate,
} from '@/lib/imports/api';
import { assetsApi } from '@/lib/registry/api';
import { seedSession } from '@/test/render';
import { MOCK_ACCOUNTS } from './fixtures';
import { setMockScanDelay } from './m2-handlers';
import { resetMockImportTiming, setMockImportTiming } from './w3-import-handlers';
import { mutateW3, w3 } from './w3-state';

/**
 * The Imports endpoints of the mock mirror the contract (docs/engineering/openapi.yaml, tag Imports)
 * and the behaviour of apps/api/src/importer: the states, the status codes (`202` for the three
 * background steps), the problems with their extension members, `If-Match` and `Idempotency-Key`,
 * the `import:read` / `import:run` split and the retention purge. The screens and Playwright are
 * written against it.
 */
async function fails(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error('expected the request to fail');
}
const code = (error: ApiError) => (error.body as { code?: string }).code;
const field = (error: ApiError) =>
  (error.body as { errors?: Array<{ pointer: string; code?: string; message: string }> }).errors;

const CSV = [
  'Serial Number,Asset ID,Category,Location,Assigned to',
  '5CG0001,IMP-0001,Chromebook,Room 101,',
  '5CG0002,IMP-0002,Chromebook,Room 999,',
  ',IMP-0003,Chromebook,Room 101,',
  '5CG0001,IMP-0004,Chromebook,Room 101,',
  '5CG0005,IMP-0005,Hovercraft,Room 101,',
  '5CG0006,IMP-0006,,Room 101,',
].join('\n');

const MAPPING = {
  columns: [
    { index: 0, target: 'serial' },
    { index: 1, target: 'asset_tag' },
    { index: 2, target: 'category' },
    { index: 3, target: 'location' },
    { index: 4, target: null },
  ],
};

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Create a draft job, upload the file against it and wait for the scan: what step 2 leaves behind. */
async function uploaded(
  text: string,
  options: {
    entity?: ImportJob['entity_type'];
    preset?: string;
    name?: string;
    type?: string;
  } = {},
) {
  const job = (
    await importsApi.create({
      entity_type: options.entity ?? 'asset',
      ...(options.preset ? { preset_key: options.preset } : {}),
    })
  ).value;
  const created = await attachmentsApi.create({
    entity_type: 'import_job',
    entity_id: job.id,
    kind: 'import_file',
    filename: options.name ?? 'devices.csv',
    content_type: options.type ?? 'text/csv',
    size_bytes: new TextEncoder().encode(text).byteLength,
  });
  await putToStorage(created.upload, new Blob([text], { type: options.type ?? 'text/csv' }));
  await attachmentsApi.complete(created.attachment.id);
  expect((await attachmentsApi.get(created.attachment.id)).scan_status).toBe('clean');
  return { job, attachmentId: created.attachment.id };
}

async function settle(id: string, wanted: ImportJob['state']) {
  for (let i = 0; i < 1000; i += 1) {
    const job = (await importsApi.get(id)).value;
    if (job.state === wanted) return job;
    if (job.state === 'failed' && wanted !== 'failed') throw new Error(job.error ?? 'failed');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the import never reached ${wanted}`);
}

/** An import whose file was uploaded and analysed. */
async function analysed(text: string, options: Parameters<typeof uploaded>[1] = {}) {
  const { job, attachmentId } = await uploaded(text, options);
  const queued = await importsApi.analyze(job.id, { file_attachment_id: attachmentId });
  expect(queued.state).toBe('analyzing');
  return settle(job.id, 'analyzed');
}

/** An analysed import with the standard mapping and the serial number as the key. */
async function mapped(text = CSV, update: ImportUpdate = {}) {
  const job = await analysed(text);
  return (
    await importsApi.update(job.id, {
      mapping: MAPPING,
      options: { match_on: 'serial', ...update.options },
      ...(update.value_map ? { value_map: update.value_map } : {}),
    })
  ).value;
}

async function reviewed(text = CSV, update: ImportUpdate = {}) {
  const job = await mapped(text, update);
  await importsApi.startDryRun(job.id);
  return settle(job.id, 'dry_run_done');
}

beforeEach(() => {
  seedSession(MOCK_ACCOUNTS.owner);
  setMockScanDelay(0);
  setMockImportTiming({ analyze: 0, start: 0, batchMs: 5, batchRows: 2 });
});
afterEach(() => resetMockImportTiming());

describe('mock imports: presets and templates', () => {
  it('lists the five presets with their data dictionary', async () => {
    const presets = await importsApi.presets();
    expect(presets.map((p) => p.key)).toEqual([
      'assets',
      'people',
      'locations',
      'departments',
      'google_admin_chromeos',
    ]);
    const assets = presets.find((p) => p.key === 'assets')!;
    expect(assets).toMatchObject({ entity_type: 'asset', source: 'csv', sets_up: null });
    expect(assets.columns.find((c) => c.target === 'category')).toMatchObject({
      column: 'Category',
      required: 'yes',
    });
    const google = presets.find((p) => p.key === 'google_admin_chromeos')!;
    expect(google).toMatchObject({ source: 'google_admin_csv' });
    expect(google.sets_up?.category).toBe('Chromebook');
    expect(google.sets_up?.custom_fields).toContain('os_version');
    expect(google.columns.some((c) => c.target === 'cf:last_sync')).toBe(true);
  });

  it('downloads a template as CSV with a byte order mark, with a column per custom field of an asset template', async () => {
    const response = await fetch('/v1/imports/presets/assets/template');
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="assets-template.csv"',
    );
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await response.text();
    const header = text.split('\r\n')[0]!;
    expect(header.startsWith('Asset tag,Name,Serial number,Category')).toBe(true);
    expect(header).toContain('cf:os_version');
    const people = await (await fetch('/v1/imports/presets/people/template?format=csv')).text();
    expect(people.split('\r\n')[0]).toContain('Employee number');
    expect(people).not.toContain('cf:');
  });

  it('downloads a template as an Excel workbook (a zip with the data dictionary on a second sheet)', async () => {
    const response = await fetch('/v1/imports/presets/departments/template?format=xlsx');
    expect(response.headers.get('content-type')).toBe(XLSX);
    expect(response.headers.get('content-disposition')).toContain('departments-template.xlsx');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe('PK');
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('xl/worksheets/sheet2.xml');
    expect(text).toContain('Data dictionary');
  });

  it('refuses an unknown preset and an unknown format', async () => {
    expect((await fetch('/v1/imports/presets/nothing/template')).status).toBe(404);
    expect((await fetch('/v1/imports/presets/assets/template?format=pdf')).status).toBe(422);
  });
});

describe('mock imports: creating and analysing', () => {
  it('creates a draft with the real shape: an empty mapping, full default options, nothing counted', async () => {
    const created = await importsApi.create({ entity_type: 'asset', preset_key: 'assets' });
    expect(created.etag).toBe('W/"1"');
    expect(created.value).toMatchObject({
      entity_type: 'asset',
      source: 'csv',
      preset_key: 'assets',
      state: 'draft',
      filename: null,
      file_attachment_id: null,
      headers: null,
      mapping: {},
      rows_total: 0,
      counts: {
        dry_run: { create: 0, update: 0, skip: 0, error: 0 },
        commit: { created: 0, updated: 0, skipped: 0, error: 0 },
      },
      progress: { phase: null, processed: 0, total: 0, percent: 0 },
      dry_run_digest: null,
      data_purged_at: null,
      cancel_requested: false,
      error: null,
      summary: null,
    });
    expect(created.value.parse).toEqual({
      format: null,
      encoding: null,
      delimiter: null,
      sheet: null,
      sheets: null,
      header_line: null,
    });
    expect(created.value.options).toMatchObject({
      match_on: 'auto',
      on_match: 'skip',
      blank_cells: 'ignore',
      date_format: 'auto',
      number_format: 'auto',
      assign: true,
      detect_changes: true,
      location_kind: 'other',
    });
  });

  it('refuses a body the contract does not know, and a preset of another kind', async () => {
    const unknown = await fails(
      importsApi.create({ entity_type: 'asset', source: 'csv' } as never),
    );
    expect(unknown.status).toBe(422);
    expect(field(unknown)?.[0]).toMatchObject({ code: 'unrecognized_keys' });
    const entity = await fails(importsApi.create({ entity_type: 'nothing' } as never));
    expect(entity.status).toBe(422);
    const preset = await fails(importsApi.create({ entity_type: 'person', preset_key: 'assets' }));
    expect(preset.status).toBe(422);
    expect(field(preset)?.[0]).toMatchObject({ pointer: '/preset_key', code: 'not-found' });
    const options = await fails(
      importsApi.create({ entity_type: 'asset', options: { match_on: 'colour' as never } }),
    );
    expect(field(options)?.[0]).toMatchObject({ pointer: '/options/match_on' });
  });

  it('creating a Google Admin import sets up the Chromebook category fields', async () => {
    const created = (
      await importsApi.create({ entity_type: 'asset', preset_key: 'google_admin_chromeos' })
    ).value;
    expect(created.source).toBe('google_admin_csv');
    expect(created.options).toMatchObject({ match_on: 'serial', on_match: 'update' });
    const setup = (
      created.summary as { setup: { category_created: boolean; custom_fields_created: string[] } }
    ).setup;
    expect(setup.category_created).toBe(false);
    expect(setup.custom_fields_created).toContain('last_sync');
    expect(setup.custom_fields_created).not.toContain('os_version');
  });

  it('queues the analysis with 202, then reads the file: headers, profile, samples, a suggested mapping', async () => {
    const { job, attachmentId } = await uploaded(CSV);
    const queued = await importsApi.analyze(job.id, { file_attachment_id: attachmentId });
    expect(queued).toMatchObject({
      state: 'analyzing',
      filename: 'devices.csv',
      file_attachment_id: attachmentId,
      progress: { phase: 'analyze' },
    });
    const done = await settle(job.id, 'analyzed');
    expect(done.headers).toEqual([
      'Serial Number',
      'Asset ID',
      'Category',
      'Location',
      'Assigned to',
    ]);
    expect(done.rows_total).toBe(6);
    expect(done.parse).toMatchObject({
      format: 'csv',
      encoding: 'utf-8',
      delimiter: ',',
      header_line: 1,
    });
    expect(done.profile).toHaveLength(5);
    expect(done.profile![0]).toMatchObject({
      index: 0,
      header: 'Serial Number',
      non_blank: 5,
      blank: 1,
      distinct: 4,
      duplicates: 1,
      type: 'text',
      date_order: null,
    });
    expect(done.profile![0]!.samples).toContain('5CG0001');
    expect(done.profile![4]).toMatchObject({ type: 'empty', non_blank: 0 });
    expect(done.samples).toHaveLength(6);
    expect(done.samples![0]).toEqual(['5CG0001', 'IMP-0001', 'Chromebook', 'Room 101', '']);
    expect(done.mapping.columns.map((c) => c.target)).toEqual([
      'serial',
      'asset_tag',
      'category',
      'location',
      'assigned_to',
    ]);
    expect(done.confidence).toMatchObject({ '0': 1, '2': 1 });
    expect(done.confidence!['1']).toBeLessThan(1);
  });

  it('names the line of a file that cannot be read, in a failed import, not a stack trace', async () => {
    const { job, attachmentId } = await uploaded('Serial,Name\n"5CG1,Broken', {
      name: 'broken.csv',
    });
    await importsApi.analyze(job.id, { file_attachment_id: attachmentId });
    const failed = await settle(job.id, 'failed');
    expect(failed.error).toMatch(/^Line 2/);
    expect(failed.headers).toBeNull();
    expect(failed.finished_at).toBeTruthy();
    // a failed import that was not committed takes another file
    const second = await uploaded('Serial\n1', { name: 'again.csv' });
    expect(second.job.id).not.toBe(job.id);
  });

  it('refuses to analyse without a file, with a file of another import, and while it is analysing', async () => {
    const draft = (await importsApi.create({ entity_type: 'asset' })).value;
    const none = await fails(importsApi.analyze(draft.id));
    expect(none.status).toBe(422);
    expect(field(none)?.[0]).toMatchObject({ pointer: '/file_attachment_id', code: 'required' });
    const other = await uploaded(CSV);
    const foreign = await fails(
      importsApi.analyze(draft.id, { file_attachment_id: other.attachmentId }),
    );
    expect(foreign.status).toBe(422);
    setMockImportTiming({ analyze: 60_000 });
    const queued = await importsApi.analyze(other.job.id, {
      file_attachment_id: other.attachmentId,
    });
    expect(queued.state).toBe('analyzing');
    const again = await fails(importsApi.analyze(other.job.id));
    expect(again.status).toBe(409);
    expect(importProblemOf(again)).toMatchObject({
      code: 'import-wrong-state',
      state: 'analyzing',
    });
    expect(importProblemOf(again)?.allowed).toContain('analyzed');
  });

  it('reads a spreadsheet: the source becomes xlsx and a sheet is reported', async () => {
    const { job, attachmentId } = await uploaded('PK binary', { name: 'devices.xlsx', type: XLSX });
    await importsApi.analyze(job.id, { file_attachment_id: attachmentId });
    const done = await settle(job.id, 'analyzed');
    expect(done.source).toBe('xlsx');
    expect(done.parse).toMatchObject({
      format: 'xlsx',
      sheet: 'Sheet1',
      sheets: ['Sheet1'],
      delimiter: null,
    });
    expect(done.headers).toContain('Serial number');
    expect(done.rows_total).toBeGreaterThan(0);
  });

  it('applies the preset to the file: Google headers, the fixed category and the status hints', async () => {
    const text = [
      'Serial Number,Annotated Asset ID,Status,Model,Annotated User,Org Unit Path,Last Sync',
      '5CD1,CHR-1,ACTIVE,HP Chromebook 14 G6,,/Students/Grade 5,2026-11-20',
    ].join('\n');
    const job = await analysed(text, { preset: 'google_admin_chromeos' });
    expect(Object.fromEntries(job.mapping.columns.map((c) => [c.index, c.target]))).toEqual({
      0: 'serial',
      1: 'asset_tag',
      2: 'status',
      3: 'model',
      4: 'assigned_to',
      5: 'location',
      6: 'cf:last_sync',
    });
    expect(job.mapping.constants).toEqual({ category: 'Chromebook' });
    expect(job.source).toBe('google_admin_csv');
    // "Active" is a deployable status: the default label is chosen for it
    expect(job.value_map!.status?.active).toMatchObject({ id: expect.any(String) });
  });
});

describe('mock imports: editing', () => {
  it('needs If-Match (428) and refuses a stale one (412); a change moves an analysed import to mapped', async () => {
    const job = await analysed(CSV);
    const current = (await importsApi.get(job.id)).etag!;
    expect((await fails(importsApi.update(job.id, { mapping: MAPPING }, ''))).status).toBe(428);
    expect((await fails(importsApi.update(job.id, { mapping: MAPPING }, 'W/"999"'))).status).toBe(
      412,
    );
    const updated = await importsApi.update(job.id, { mapping: MAPPING }, current);
    expect(updated.value.state).toBe('mapped');
    expect(updated.etag).not.toBe(current);
  });

  it('refuses unknown or repeated targets, columns the file lacks and defaults that do not exist (422)', async () => {
    const job = await analysed(CSV);
    const unknown = await fails(
      importsApi.update(job.id, { mapping: { columns: [{ index: 0, target: 'colour' }] } }),
    );
    expect(unknown.status).toBe(422);
    expect(field(unknown)?.[0]).toMatchObject({ code: 'target' });
    const twice = await fails(
      importsApi.update(job.id, {
        mapping: {
          columns: [
            { index: 0, target: 'serial' },
            { index: 1, target: 'serial' },
          ],
        },
      }),
    );
    expect(field(twice)?.[0]).toMatchObject({ code: 'duplicate' });
    const column = await fails(
      importsApi.update(job.id, { mapping: { columns: [{ index: 9, target: 'serial' }] } }),
    );
    expect(field(column)?.[0]).toMatchObject({ code: 'column' });
    const custom = await fails(
      importsApi.update(job.id, { mapping: { columns: [{ index: 0, target: 'cf:nothing' }] } }),
    );
    expect(field(custom)?.[0]).toMatchObject({ code: 'target' });
    const defaults = await fails(
      importsApi.update(job.id, {
        options: { defaults: { category: '0190a6b2-0001-7000-8000-000000999999' } },
      }),
    );
    expect(field(defaults)?.[0]).toMatchObject({
      pointer: '/options/defaults/category',
      code: 'not-found',
    });
    const entry = await fails(
      importsApi.update(job.id, { value_map: { category: { x: { create: false } } } as never }),
    );
    expect(entry.status).toBe(422);
    // missing essentials are not an error of an edit, only of the dry run
    const ok = await importsApi.update(job.id, {
      mapping: { columns: [{ index: 0, target: 'serial' }] },
    });
    expect(ok.value.state).toBe('mapped');
  });

  it('merges the options and the reference policies, replaces the value map entries of a kind', async () => {
    const job = await analysed(CSV);
    await importsApi.update(job.id, {
      options: { references: { category: 'must_exist' }, match_on: 'serial' },
      value_map: { location: { 'room 999': { create: true }, 'room 101': { skip: true } } },
    });
    const second = (
      await importsApi.update(job.id, {
        options: { references: { location: 'must_exist' } },
        value_map: { location: { 'room 999': { skip: true } } },
      })
    ).value;
    expect(second.options.references).toEqual({ category: 'must_exist', location: 'must_exist' });
    expect(second.options.match_on).toBe('serial');
    expect(second.value_map!.location).toEqual({ 'room 999': { skip: true } });
    await importsApi.update(job.id, { value_map: { location: {} } });
    expect((await importsApi.get(job.id)).value.value_map!.location).toEqual({});
  });
});

describe('mock imports: the values of a reference column', () => {
  it('counts the distinct values with the record each matches by name and the current decision', async () => {
    const job = await mapped(CSV, { value_map: { location: { 'room 999': { create: true } } } });
    const locations = await importsApi.values(job.id, 'location');
    expect(locations).toMatchObject({ field: 'location', column: 'Location', distinct: 2 });
    const room101 = locations.data.find((v) => v.value === 'Room 101')!;
    expect(room101).toMatchObject({ count: 5, entry: null });
    expect(room101.suggestion?.name).toBe('Riverside Elementary > Main building > Room 101');
    expect(locations.data.find((v) => v.value === 'Room 999')).toMatchObject({
      count: 1,
      suggestion: null,
      entry: { create: true },
    });
    const categories = await importsApi.values(job.id, 'category');
    expect(categories.data[0]).toMatchObject({ value: 'Chromebook', count: 4 });
    expect(categories.data.find((v) => v.value === 'Hovercraft')?.suggestion).toBeNull();
    expect(categories.data.find((v) => v.value === 'Chromebook')?.suggestion?.name).toBe(
      'Chromebook',
    );
  });

  it('searches with q, answers 422 for a kind without a column and 403 without import:run', async () => {
    const job = await mapped();
    const found = await importsApi.values(job.id, 'location', { q: '999' });
    expect(found.data.map((v) => v.value)).toEqual(['Room 999']);
    const none = await fails(importsApi.values(job.id, 'vendor'));
    expect(none.status).toBe(422);
    expect(field(none)?.[0]).toMatchObject({ pointer: 'query:field', code: 'invalid' });
    seedSession(MOCK_ACCOUNTS.viewer);
    expect((await fails(importsApi.values(job.id, 'location'))).status).toBe(403);
  });
});

describe('mock imports: the dry run', () => {
  it('needs an analysed import (409 with the state and the allowed ones) and a valid mapping (422)', async () => {
    const draft = (await importsApi.create({ entity_type: 'asset' })).value;
    const early = await fails(importsApi.startDryRun(draft.id));
    expect(early.status).toBe(409);
    expect(importProblemOf(early)).toMatchObject({
      code: 'import-wrong-state',
      state: 'draft',
      allowed: ['analyzed', 'mapped', 'dry_run_done'],
    });
    const job = await analysed(CSV);
    await importsApi.update(job.id, { mapping: { columns: [{ index: 0, target: 'serial' }] } });
    const missing = await fails(importsApi.startDryRun(job.id));
    expect(missing.status).toBe(422);
    expect(field(missing)?.[0]).toMatchObject({ pointer: '/mapping', code: 'required' });
  });

  it('queues the dry run with 202, shows progress, then classifies every row and writes nothing', async () => {
    setMockImportTiming({ batchMs: 60, batchRows: 2 });
    const before = (await assetsApi.list({ limit: 1, include_total: true })).page.total;
    const job = await mapped();
    const queued = await importsApi.startDryRun(job.id);
    expect(queued).toMatchObject({
      state: 'dry_running',
      progress: { phase: 'dry_run', total: 6 },
    });
    const done = await settle(job.id, 'dry_run_done');
    expect(done.counts.dry_run).toEqual({ create: 4, update: 0, skip: 1, error: 1 });
    expect(done.dry_run_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(done.dry_run_at).toBeTruthy();
    expect(done.progress).toMatchObject({ phase: null, processed: 6, total: 6, percent: 100 });
    const summary = done.summary as {
      counts: Record<string, number>;
      errors_by_code: Array<{ code: string; field: string | null; n: number }>;
      will_create: Array<{ field: string; message: string; n: number }>;
    };
    expect(summary.counts).toEqual({ create: 4, update: 0, skip: 1, error: 1 });
    expect(summary.errors_by_code).toEqual([{ code: 'required', field: 'category', n: 1 }]);
    expect(summary.will_create.map((w) => w.message)).toEqual(
      expect.arrayContaining([
        'Location "Room 999" will be created.',
        'Category "Hovercraft" will be created.',
      ]),
    );
    expect((await assetsApi.list({ limit: 1, include_total: true })).page.total).toBe(before);
  });

  it('lists the rows with their verdicts, filters by outcome and warnings and pages with a cursor', async () => {
    const job = await reviewed();
    const all = await importsApi.rows(job.id, { limit: 4 });
    expect(all.data.map((r) => r.row_no)).toEqual([1, 2, 3, 4]);
    expect(all.page.has_more).toBe(true);
    const rest = await importsApi.rows(job.id, { limit: 4, cursor: all.page.next_cursor! });
    expect(rest.data.map((r) => r.row_no)).toEqual([5, 6]);
    expect(rest.page).toEqual({ next_cursor: null, has_more: false });
    const first = all.data[0]!;
    expect(first).toMatchObject({
      row_no: 1,
      line_no: 2,
      phase: 'dry_run',
      outcome: 'create',
      plan: 'create',
      result: null,
      errors: [],
      source: {
        'Serial Number': '5CG0001',
        'Asset ID': 'IMP-0001',
        Category: 'Chromebook',
        Location: 'Room 101',
      },
    });
    expect(first.mapped).toMatchObject({ f: { serial: '5CG0001', asset_tag: 'IMP-0001' } });
    const errors = await importsApi.rows(job.id, { outcome: ['error'] });
    expect(errors.data.map((r) => r.row_no)).toEqual([6]);
    expect(errors.data[0]!.errors[0]).toMatchObject({ field: 'category', code: 'required' });
    const skipped = await importsApi.rows(job.id, { outcome: ['skip'] });
    expect(skipped.data[0]).toMatchObject({ row_no: 4, duplicate_of: 1 });
    expect(skipped.data[0]!.warnings[0]).toMatchObject({ code: 'duplicate-in-file' });
    const warned = await importsApi.rows(job.id, { has_warnings: true });
    expect(warned.data.map((r) => r.row_no)).toEqual([2, 4, 5]);
    expect((await fails(importsApi.rows(job.id, { limit: 0 }))).status).toBe(400);
  });

  it('applies the value decisions and the reference policies', async () => {
    const decided = await reviewed(CSV, {
      options: { references: { location: 'must_exist' } },
      value_map: {
        location: { 'room 999': { create: true } },
        category: { hovercraft: { skip: true } },
      },
    });
    expect(decided.counts.dry_run).toMatchObject({ create: 3, error: 2 });
    const rows = (await importsApi.rows(decided.id)).data;
    expect(rows.find((r) => r.row_no === 2)!.warnings.some((w) => w.code === 'will-create')).toBe(
      true,
    );
    // "skip" leaves the category empty, which an asset cannot do
    expect(rows.find((r) => r.row_no === 5)!.errors[0]).toMatchObject({
      code: 'required',
      field: 'category',
    });
    const strict = await reviewed(CSV, { options: { references: { location: 'must_exist' } } });
    const row2 = (await importsApi.rows(strict.id)).data.find((r) => r.row_no === 2)!;
    expect(row2.outcome).toBe('error');
    expect(row2.errors[0]).toMatchObject({ code: 'not-found', field: 'location' });
  });

  it('serves the error report as a CSV with a byte order mark and the original cells', async () => {
    const job = await reviewed();
    const report = await fetch(`/v1/imports/${job.id}/errors.csv`);
    expect(report.headers.get('content-type')).toContain('text/csv');
    expect(report.headers.get('content-disposition')).toBe(
      `attachment; filename="import-${job.id.slice(0, 8)}-errors.csv"`,
    );
    const bytes = new Uint8Array(await report.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await report.text();
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Row,Line,Fields,Problems,Warnings,Serial Number,Asset ID,Category,Location,Assigned to',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('6,7,category,');
    expect(lines[1]).toContain('5CG0006,IMP-0006');
  });

  it('edits after a dry run take the import back to mapped and drop the digest', async () => {
    const job = await reviewed();
    expect(job.dry_run_digest).toBeTruthy();
    const back = await importsApi.update(job.id, { options: { on_match: 'update' } });
    expect(back.value).toMatchObject({ state: 'mapped', dry_run_digest: null });
    expect(back.value.counts.dry_run).toEqual({ create: 0, update: 0, skip: 0, error: 0 });
  });

  it('stops at most 2 imports at once (429 with Retry-After)', async () => {
    setMockImportTiming({ batchMs: 60_000, start: 60_000 });
    const jobs = [await mapped(), await mapped(), await mapped()];
    await importsApi.startDryRun(jobs[0]!.id);
    await importsApi.startDryRun(jobs[1]!.id);
    const refused = await fails(importsApi.startDryRun(jobs[2]!.id));
    expect(refused.status).toBe(429);
    expect(importProblemOf(refused)).toMatchObject({
      code: 'import-quota-exceeded',
      retryAfterSeconds: 30,
    });
  });

  it('cancels a running dry run after the current batch', async () => {
    setMockImportTiming({ batchMs: 50, batchRows: 1 });
    const job = await mapped();
    await importsApi.startDryRun(job.id);
    const asked = await importsApi.cancel(job.id);
    expect(asked.cancel_requested).toBe(true);
    const done = await settle(job.id, 'cancelled');
    expect(done.finished_at).toBeTruthy();
  });
});

describe('mock imports: the commit', () => {
  it('needs the reviewed digest: 422 for a malformed one, 409 stale with the current one, 409 in the wrong state', async () => {
    const job = await reviewed();
    const bad = await fails(importsApi.commit(job.id, 'nonsense', 'key-commit-0001'));
    expect(bad.status).toBe(422);
    const stale = await fails(importsApi.commit(job.id, 'a'.repeat(64), 'key-commit-0002'));
    expect(stale.status).toBe(409);
    expect(importProblemOf(stale)).toMatchObject({
      code: 'import-stale-dry-run',
      currentDigest: job.dry_run_digest,
    });
    const early = await fails(
      importsApi.commit((await mapped()).id, 'a'.repeat(64), 'key-commit-0003'),
    );
    expect(early.status).toBe(409);
    expect(importProblemOf(early)).toMatchObject({
      code: 'import-wrong-state',
      state: 'mapped',
      allowed: ['dry_run_done'],
    });
  });

  it('needs an Idempotency-Key', async () => {
    const job = await reviewed();
    const missing = await fails(importsApi.commit(job.id, job.dry_run_digest!, ''));
    expect(missing.status).toBe(400);
    expect(code(missing)).toBe('idempotency-key-required');
  });

  it('commits with 202 and progress, writes the assets and lists the commit rows; the same key replays the answer', async () => {
    setMockImportTiming({ batchMs: 40, batchRows: 2 });
    const job = await reviewed();
    const queued = await importsApi.commit(job.id, job.dry_run_digest!, 'key-commit-0004');
    expect(queued).toMatchObject({ state: 'committing', progress: { phase: 'commit', total: 6 } });
    const done = await settle(job.id, 'completed');
    expect(done.counts.commit).toEqual({ created: 4, updated: 0, skipped: 1, error: 1 });
    expect(done.committed_at).toBeTruthy();
    expect(done.finished_at).toBeTruthy();
    const imported = await assetsApi.list({ q: 'IMP-000', limit: 20 });
    expect(imported.data.map((a) => a.asset_tag).sort()).toEqual([
      'IMP-0001',
      'IMP-0002',
      'IMP-0003',
      'IMP-0005',
    ]);
    const failedRows = await importsApi.rows(job.id, { phase: 'commit', outcome: ['error'] });
    expect(failedRows.data).toHaveLength(1);
    expect(failedRows.data[0]).toMatchObject({
      phase: 'commit',
      outcome: 'error',
      result: 'error',
    });
    const created = await importsApi.rows(job.id, { outcome: ['created'] });
    expect(created.data.map((r) => r.row_no)).toEqual([1, 2, 3, 5]);
    expect(created.data[0]!.created_id).toBeTruthy();
    // the rows default to the commit phase once it ran
    expect((await importsApi.rows(job.id)).data[0]!.phase).toBe('commit');
    const replay = await importsApi.commit(job.id, job.dry_run_digest!, 'key-commit-0004');
    expect(replay.id).toBe(job.id);
    expect((await assetsApi.list({ q: 'IMP-000', limit: 20 })).data).toHaveLength(4);
    const report = await (await fetch(`/v1/imports/${job.id}/errors.csv`)).text();
    expect(report.trim().split('\r\n')).toHaveLength(2);
  });

  it('leaves a record alone that was edited after the dry run (changed-since-dry-run)', async () => {
    const existing = (await assetsApi.list({ limit: 1 })).data[0]!;
    const text = `Asset ID,Category,Name\n${existing.asset_tag},Chromebook,Renamed by the import`;
    const job = await analysed(text);
    await importsApi.update(job.id, {
      mapping: {
        columns: [
          { index: 0, target: 'asset_tag' },
          { index: 1, target: 'category' },
          { index: 2, target: 'name' },
        ],
      },
      options: { on_match: 'update' },
    });
    await importsApi.startDryRun(job.id);
    const done = await settle(job.id, 'dry_run_done');
    expect(done.counts.dry_run).toMatchObject({ update: 1, create: 0 });
    // somebody edits the asset after the review
    const current = await assetsApi.get(existing.id);
    await assetsApi.update(existing.id, { notes: 'edited meanwhile' }, current.etag);
    await importsApi.commit(job.id, done.dry_run_digest!, 'key-changed-0001');
    const finished = await settle(job.id, 'completed');
    expect(finished.counts.commit).toMatchObject({ updated: 0, error: 1 });
    const row = (await importsApi.rows(job.id, { phase: 'commit' })).data[0]!;
    expect(row.errors[0]).toMatchObject({ code: 'changed-since-dry-run' });
  });

  it('cancels a running commit after the current batch; the rows already written stay', async () => {
    // review at the fast pace of the other tests; only the commit is slow enough to cancel (setting the
    // slow pace first also slowed the dry run to one row per 300 ms: seconds of waiting that a loaded
    // machine stretched past the 15 s test timeout)
    const job = await reviewed();
    setMockImportTiming({ batchMs: 300, batchRows: 1 });
    await importsApi.commit(job.id, job.dry_run_digest!, 'key-cancel-0001');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await importsApi.cancel(job.id);
    const done = await settle(job.id, 'cancelled');
    expect(done.counts.commit.created).toBeGreaterThan(0);
    expect(done.counts.commit.created).toBeLessThan(4);
    const again = await fails(importsApi.cancel(job.id));
    expect(again.status).toBe(409);
    expect(importProblemOf(again)?.code).toBe('import-wrong-state');
  });

  it('cancels at once an import that is not running', async () => {
    const job = await analysed(CSV);
    const cancelled = await importsApi.cancel(job.id);
    expect(cancelled.state).toBe('cancelled');
    expect((await fails(importsApi.update(job.id, { mapping: MAPPING }))).status).toBe(409);
  });
});

describe('mock imports: other kinds of data', () => {
  it('imports people: matched by email, created with their department', async () => {
    const text =
      'Name,Email,Department\nAda Lovelace,ada@school.example,Science\nSam Lee,sam@school.example,Science';
    const job = await analysed(text, { entity: 'person', name: 'people.csv' });
    expect(job.mapping.columns.map((c) => c.target)).toEqual([
      'display_name',
      'email',
      'department',
    ]);
    await importsApi.startDryRun(job.id);
    const done = await settle(job.id, 'dry_run_done');
    expect(done.counts.dry_run).toMatchObject({ create: 2 });
    await importsApi.commit(job.id, done.dry_run_digest!, 'key-people-0001');
    const finished = await settle(job.id, 'completed');
    expect(finished.counts.commit.created).toBe(2);
  });

  it('imports locations from a path and departments by name', async () => {
    const places = await analysed('Path,Kind\nAnnex > Wing A > Room 1,room', {
      entity: 'location',
      name: 'places.csv',
    });
    expect(places.mapping.columns.map((c) => c.target)).toEqual(['path', 'kind']);
    await importsApi.startDryRun(places.id);
    const done = await settle(places.id, 'dry_run_done');
    await importsApi.commit(places.id, done.dry_run_digest!, 'key-places-0001');
    await settle(places.id, 'completed');
    const departments = await analysed('Name,Code\nRobotics Club,RC-1', {
      entity: 'department',
      name: 'departments.csv',
    });
    await importsApi.startDryRun(departments.id);
    const reviewedDepartments = await settle(departments.id, 'dry_run_done');
    expect(reviewedDepartments.counts.dry_run.create).toBe(1);
  });
});

describe('mock imports: saved mapping templates', () => {
  it('saves the mapping of an import by header, applies it to another file and keeps one name per kind', async () => {
    const job = await mapped();
    const saved = await importTemplatesApi.createFromImport('Our spreadsheet', job.id);
    expect(saved).toMatchObject({
      name: 'Our spreadsheet',
      entity_type: 'asset',
      description: null,
    });
    expect(saved.columns).toEqual([
      { header: 'Serial Number', target: 'serial' },
      { header: 'Asset ID', target: 'asset_tag' },
      { header: 'Category', target: 'category' },
      { header: 'Location', target: 'location' },
    ]);
    expect(saved.options).toMatchObject({ match_on: 'serial' });
    expect((await importTemplatesApi.list('asset')).map((t) => t.name)).toEqual([
      'Our spreadsheet',
    ]);
    expect(await importTemplatesApi.list('person')).toEqual([]);
    const dup = await fails(importTemplatesApi.createFromImport('our SPREADSHEET', job.id));
    expect(dup.status).toBe(409);
    expect(field(dup)?.[0]).toMatchObject({ pointer: '/name', code: 'duplicate' });
    // another file with the columns in another order
    const other = await analysed('Category,Asset ID,Serial Number\nChromebook,X-1,S-1');
    const applied = await importsApi.applyTemplate(other.id, saved.id);
    expect(applied.value.state).toBe('mapped');
    expect(applied.value.mapping.columns.map((c) => c.target)).toEqual([
      'category',
      'asset_tag',
      'serial',
    ]);
    expect(applied.value.options.match_on).toBe('serial');
    // a draft cannot take a template
    const draft = (await importsApi.create({ entity_type: 'asset' })).value;
    const wrong = await fails(importsApi.applyTemplate(draft.id, saved.id));
    expect(importProblemOf(wrong)?.code).toBe('import-wrong-state');
  });

  it('deletes with If-Match and answers 404 afterwards', async () => {
    const job = await mapped();
    const saved = await importTemplatesApi.createFromImport('Short lived', job.id);
    expect((await fails(importTemplatesApi.remove(saved.id, 'W/"9"'))).status).toBe(412);
    await importTemplatesApi.remove(saved.id);
    expect((await fails(importTemplatesApi.get(saved.id))).status).toBe(404);
    expect(await importTemplatesApi.list()).toEqual([]);
  });

  it('needs either an import or an entity type with columns', async () => {
    const error = await fails(
      importTemplatesApi.createFromImport('x', '0190a6b2-00b2-7000-8000-000000000999'),
    );
    expect(error.status).toBe(404);
  });
});

describe('mock imports: lists, read and run permissions, retention', () => {
  it('lists the imports newest first without the heavy members, and filters', async () => {
    const first = await analysed(CSV);
    await analysed('Name\nScience', { entity: 'department', name: 'two.csv' });
    const all = await importsApi.list();
    expect(all.data.map((j) => j.filename)).toEqual(['two.csv', 'devices.csv']);
    expect(all.data[0]).not.toHaveProperty('profile');
    expect(all.data[0]).not.toHaveProperty('samples');
    expect(all.data[0]).not.toHaveProperty('value_map');
    expect(all.page).toMatchObject({ has_more: false });
    expect(
      (await importsApi.list({ state: ['analyzed'], entity_type: 'asset' })).data.map((j) => j.id),
    ).toEqual([first.id]);
    expect((await importsApi.list({ state: ['completed'] })).data).toEqual([]);
    expect((await fails(importsApi.list({ state: ['committed'] as never }))).status).toBe(400);
  });

  it('import:read shows the shape of the file and the counts, not its cells, rows or values', async () => {
    const job = await reviewed(CSV, { value_map: { location: { 'room 999': { create: true } } } });
    seedSession(MOCK_ACCOUNTS.viewer);
    const seen = (await importsApi.get(job.id)).value;
    expect(seen.state).toBe('dry_run_done');
    expect(seen.headers).toHaveLength(5);
    expect(seen.counts.dry_run.create).toBe(4);
    expect(seen.samples).toBeNull();
    expect(seen.value_map).toEqual({});
    expect(seen.profile![0]).toMatchObject({ header: 'Serial Number', non_blank: 5, samples: [] });
    expect((await importsApi.presets()).length).toBe(5);
    expect((await importTemplatesApi.list()).length).toBe(0);
    expect((await fails(importsApi.rows(job.id))).status).toBe(403);
    expect((await fails(importsApi.values(job.id, 'location'))).status).toBe(403);
    expect((await fetch(`/v1/imports/${job.id}/errors.csv`)).status).toBe(403);
    expect(
      (await fails(importsApi.update(job.id, { options: { on_match: 'update' } }))).status,
    ).toBe(403);
    expect((await fails(importsApi.startDryRun(job.id))).status).toBe(403);
    expect((await fails(importsApi.create({ entity_type: 'asset' }))).status).toBe(403);
  });

  it('removes the rows, profile, samples, value map and file of a finished import after the retention period', async () => {
    const job = await reviewed();
    await importsApi.commit(job.id, job.dry_run_digest!, 'key-purge-0001');
    const done = await settle(job.id, 'completed');
    expect(done.data_purged_at).toBeNull();
    expect(w3().importRows.filter((r) => r.job_id === job.id)).toHaveLength(6);
    // 29 days later nothing happens, 31 days later the details are removed
    const day = 86_400_000;
    mutateW3(() => {
      w3().importJobs.find((j) => j.id === job.id)!.finished_at = new Date(
        Date.now() - 29 * day,
      ).toISOString();
    });
    expect((await importsApi.get(job.id)).value.data_purged_at).toBeNull();
    mutateW3(() => {
      w3().importJobs.find((j) => j.id === job.id)!.finished_at = new Date(
        Date.now() - 31 * day,
      ).toISOString();
    });
    const purged = (await importsApi.get(job.id)).value;
    expect(purged).toMatchObject({
      state: 'completed',
      filename: 'devices.csv',
      rows_total: 6,
      file_attachment_id: null,
      profile: null,
      samples: null,
      value_map: {},
      counts: { commit: { created: 4, skipped: 1, error: 1 } },
    });
    expect(purged.data_purged_at).toBeTruthy();
    expect(purged.mapping.columns).toHaveLength(5);
    expect((await importsApi.rows(job.id)).data).toEqual([]);
    const report = await (await fetch(`/v1/imports/${job.id}/errors.csv`)).text();
    expect(report.trim().split('\r\n')).toHaveLength(1);
  });

  it('answers 404 for an import that does not exist', async () => {
    const missing = '0190a6b2-00b2-7000-8000-000000000999';
    expect((await fails(importsApi.get(missing))).status).toBe(404);
    expect((await fails(importsApi.startDryRun(missing))).status).toBe(404);
    expect((await fails(importsApi.cancel(missing))).status).toBe(404);
  });
});
