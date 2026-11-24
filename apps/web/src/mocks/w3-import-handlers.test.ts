import { ApiError } from '@assettracker/api-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachmentsApi, putToStorage } from '@/lib/files/api';
import { downloadErrorReport, importsApi, type ImportJob, type ValueMap } from '@/lib/imports/api';
import { assetsApi } from '@/lib/registry/api';
import { seedSession } from '@/test/render';
import { MOCK_ACCOUNTS } from './fixtures';
import { setMockScanDelay } from './m2-handlers';
import { setMockImportTiming } from './w3-import-handlers';

/**
 * The M2 wave 3 mock endpoints mirror the contract (docs/engineering/openapi.yaml, including the
 * `[M2-W3 WEB proposal]` operations): the screens and Playwright are written against them.
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

// ---- imports ---------------------------------------------------------------------------------------

const CSV = [
  'Serial Number,Asset ID,Category,Location,Assigned to',
  '5CG0001,IMP-0001,Chromebook,Room 101,',
  '5CG0002,IMP-0002,Chromebook,Room 999,',
  ',IMP-0003,Chromebook,Room 101,',
  '5CG0001,IMP-0004,Chromebook,Room 101,',
  '5CG0005,IMP-0005,Hovercraft,Room 101,',
].join('\n');

/** Create a draft job, upload the file against it, wait for the scan and attach it. */
async function draftWith(
  text: string,
  entity: ImportJob['entity_type'] = 'asset',
  name = 'devices.csv',
) {
  const job = (await importsApi.create({ source: 'csv', entity_type: entity })).value;
  const created = await attachmentsApi.create({
    entity_type: 'import_job',
    entity_id: job.id,
    kind: 'import_file',
    filename: name,
    content_type: 'text/csv',
    size_bytes: new TextEncoder().encode(text).byteLength,
  });
  await putToStorage(created.upload, new Blob([text], { type: 'text/csv' }));
  await attachmentsApi.complete(created.attachment.id);
  const clean = await attachmentsApi.get(created.attachment.id);
  expect(clean.scan_status).toBe('clean');
  return (await importsApi.update(job.id, { file_attachment_id: created.attachment.id })).value;
}

async function settle(id: string, wanted: ImportJob['state']) {
  for (let i = 0; i < 200; i += 1) {
    const job = (await importsApi.get(id)).value;
    if (job.state === wanted) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the import never reached ${wanted}`);
}

describe('mock imports', () => {
  beforeEach(() => {
    seedSession(MOCK_ACCOUNTS.owner);
    setMockScanDelay(0);
    setMockImportTiming({ queued: 0, dryRun: 20, perRow: 0, batchMs: 5, batchRows: 2 });
  });
  afterEach(() =>
    setMockImportTiming({ queued: 300, dryRun: 600, perRow: 4, batchMs: 400, batchRows: 25 }),
  );

  it('creates a draft job, keeps the file for the job and refuses a file of another job', async () => {
    const job = await draftWith(CSV);
    expect(job).toMatchObject({
      state: 'draft',
      source: 'csv',
      entity_type: 'asset',
      original_filename: 'devices.csv',
    });
    expect(job.file_attachment_id).toBeTruthy();
    const other = (await importsApi.create({ source: 'csv', entity_type: 'asset' })).value;
    const err = await fails(
      importsApi.update(other.id, { file_attachment_id: job.file_attachment_id! }),
    );
    expect(err.status).toBe(422);
    const rejected = await fails(
      importsApi.create({ source: 'csv', entity_type: 'nothing' as never }),
    );
    expect(rejected.status).toBe(422);
  });

  it('analyses the file: columns, examples, types and suggested fields', async () => {
    const job = await draftWith(CSV);
    const analysis = await importsApi.analysis(job.id);
    expect(analysis).toMatchObject({
      status: 'ready',
      delimiter: ',',
      rows_total: 5,
      encoding: 'utf-8',
    });
    const serial = analysis.columns.find((c) => c.name === 'Serial Number')!;
    expect(serial).toMatchObject({
      suggested_field: 'serial',
      empty_count: 1,
      detected_type: 'text',
    });
    expect(serial.sample_values).toContain('5CG0001');
    expect(analysis.columns.find((c) => c.name === 'Asset ID')?.suggested_field).toBe('asset_tag');
    expect(analysis.columns.find((c) => c.name === 'Location')?.suggested_field).toBe('location');
    expect(analysis.columns.find((c) => c.name === 'Assigned to')?.suggested_field).toBe(
      'assignee',
    );
  });

  it('reports a file that cannot be read with the line, not a stack trace', async () => {
    const job = await draftWith('Serial,Name\n"5CG1,Broken', 'asset', 'broken.csv');
    const analysis = await importsApi.analysis(job.id);
    expect(analysis.status).toBe('failed');
    expect(analysis.error).toMatch(/^Line 2/);
  });

  it('lists the fields a column can go to, with the custom fields of the categories', async () => {
    const assetFields = await importsApi.targetFields('asset');
    expect(assetFields.find((f) => f.key === 'serial')).toMatchObject({
      type: 'text',
      custom: false,
    });
    expect(assetFields.find((f) => f.key === 'category')).toMatchObject({
      type: 'reference',
      reference: 'category',
    });
    expect(assetFields.some((f) => f.custom && f.key.startsWith('custom_data.'))).toBe(true);
    const people = await importsApi.targetFields('person');
    expect(people.find((f) => f.key === 'display_name')?.required).toBe(true);
  });

  it('shows the values that match nothing and takes the decisions back in the options', async () => {
    const job = await draftWith(CSV);
    await importsApi.update(job.id, {
      mapping: { 'Serial Number': 'serial', Category: 'category', Location: 'location' },
    });
    const lookups = await importsApi.lookups(job.id);
    const location = lookups.find((l) => l.field === 'location')!;
    expect(location.values.find((v) => v.value === 'Room 101')?.match).not.toBeNull();
    expect(location.values.find((v) => v.value === 'Room 999')).toMatchObject({
      rows: 1,
      match: null,
    });
    const category = lookups.find((l) => l.field === 'category')!;
    expect(category.values.find((v) => v.value === 'Hovercraft')?.match).toBeNull();
  });

  it('a dry run classifies every row and writes nothing', async () => {
    const before = (await assetsApi.list({ limit: 1, include_total: true })).page.total;
    const job = await draftWith(CSV);
    await importsApi.update(job.id, {
      mapping: {
        'Serial Number': 'serial',
        'Asset ID': 'asset_tag',
        Category: 'category',
        Location: 'location',
      },
      options: { match_on: 'serial', on_duplicate: 'skip', create_missing_references: false },
    });
    const queued = await importsApi.startDryRun(job.id);
    expect(['dry_run_queued', 'dry_run_running']).toContain(queued.state);
    const done = await settle(job.id, 'dry_run_complete');
    expect(done).toMatchObject({ rows_total: 5, rows_create: 1, rows_skip: 1, rows_error: 3 });
    expect(done.dry_run_digest).toBeTruthy();
    const errors = await importsApi.rows(job.id, { outcome: ['error'] });
    expect(errors.data.map((r) => r.row_no)).toEqual([3, 4, 6]);
    expect(errors.data[0]!.errors[0]).toMatchObject({ pointer: '/location', code: 'not-found' });
    const skipped = await importsApi.rows(job.id, { outcome: ['skip'] });
    expect(skipped.data[0]!.warnings[0]!.message).toBe('Duplicate of row 2 in the file');
    // nothing was written
    expect((await assetsApi.list({ limit: 1, include_total: true })).page.total).toBe(before);
  });

  it('pages the rows with a cursor', async () => {
    const job = await draftWith(CSV);
    await importsApi.update(job.id, {
      mapping: { 'Serial Number': 'serial', Category: 'category' },
    });
    await importsApi.startDryRun(job.id);
    await settle(job.id, 'dry_run_complete');
    const first = await importsApi.rows(job.id, { limit: 2 });
    expect(first.data.map((r) => r.row_no)).toEqual([2, 3]);
    expect(first.page.has_more).toBe(true);
    const second = await importsApi.rows(job.id, { limit: 2, cursor: first.page.next_cursor! });
    expect(second.data.map((r) => r.row_no)).toEqual([4, 5]);
  });

  it('applies the value decisions: create, map and skip', async () => {
    const job = await draftWith(CSV);
    const valueMap: ValueMap = {
      location: { 'Room 999': { action: 'create' } },
      category: { Hovercraft: { action: 'skip' } },
    };
    await importsApi.update(job.id, {
      mapping: { 'Serial Number': 'serial', Category: 'category', Location: 'location' },
      options: { match_on: 'serial', create_missing_references: false, value_map: valueMap },
    });
    await importsApi.startDryRun(job.id);
    const done = await settle(job.id, 'dry_run_complete');
    expect(done.rows_error).toBe(2);
    const row3 = (await importsApi.rows(job.id, { limit: 5 })).data.find((r) => r.row_no === 3)!;
    expect(row3.outcome).toBe('create');
    expect(row3.warnings.some((w) => w.code === 'will-create')).toBe(true);
  });

  it('commits the reviewed dry run in batches with progress, then the assets exist', async () => {
    const job = await draftWith(CSV);
    await importsApi.update(job.id, {
      mapping: { 'Serial Number': 'serial', 'Asset ID': 'asset_tag', Category: 'category' },
      options: { match_on: 'serial', on_duplicate: 'skip', create_missing_references: false },
    });
    await importsApi.startDryRun(job.id);
    const reviewed = await settle(job.id, 'dry_run_complete');
    const stale = await fails(importsApi.commit(job.id, 'dry-nonsense', 'key-commit-0001'));
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('import-stale-dry-run');
    const queued = await importsApi.commit(job.id, reviewed.dry_run_digest!, 'key-commit-0002');
    expect(['commit_queued', 'committing']).toContain(queued.state);
    const done = await settle(job.id, 'committed');
    expect(done.commit_progress).toMatchObject({ created: 2, failed: 2, skipped: 1 });
    expect(done.committed_at).toBeTruthy();
    const imported = await assetsApi.list({ q: 'IMP-000', limit: 20 });
    expect(imported.data.map((a) => a.asset_tag).sort()).toEqual(['IMP-0001', 'IMP-0002']);
    // the same key replays the first answer instead of starting a second commit
    const replay = await importsApi.commit(job.id, reviewed.dry_run_digest!, 'key-commit-0002');
    expect(replay).toMatchObject({ id: job.id, state: 'commit_queued' });
    expect((await assetsApi.list({ q: 'IMP-000', limit: 20 })).data).toHaveLength(2);
  });

  it('cancels a running commit after the current batch', async () => {
    setMockImportTiming({ batchMs: 60, batchRows: 1 });
    const job = await draftWith(CSV);
    await importsApi.update(job.id, {
      mapping: { 'Serial Number': 'serial', 'Asset ID': 'asset_tag', Category: 'category' },
      options: { match_on: 'serial', create_missing_references: false },
    });
    await importsApi.startDryRun(job.id);
    const reviewed = await settle(job.id, 'dry_run_complete');
    await importsApi.commit(job.id, reviewed.dry_run_digest!, 'key-cancel-0001');
    await importsApi.cancel(job.id);
    const done = await settle(job.id, 'cancelled');
    expect(done.commit_progress!.created).toBeLessThan(3);
    const again = await fails(importsApi.cancel(job.id));
    expect(again.status).toBe(409);
  });

  it('editing a reviewed dry run takes it back to a draft and drops the digest', async () => {
    const job = await draftWith(CSV);
    await importsApi.update(job.id, { mapping: { 'Serial Number': 'serial' } });
    await importsApi.startDryRun(job.id);
    await settle(job.id, 'dry_run_complete');
    const back = await importsApi.update(job.id, {
      mapping: { 'Serial Number': 'serial', Category: 'category' },
    });
    expect(back.value).toMatchObject({ state: 'draft', dry_run_digest: null });
    const bad = await fails(importsApi.startDryRun('0190a6b2-00b2-7000-8000-000000000999'));
    expect(bad.status).toBe(404);
  });

  it('serves the error report and the templates as CSV', async () => {
    const job = await draftWith(CSV);
    await importsApi.update(job.id, {
      mapping: { 'Serial Number': 'serial', Location: 'location' },
      options: { match_on: 'serial', create_missing_references: false },
    });
    await importsApi.startDryRun(job.id);
    await settle(job.id, 'dry_run_complete');
    const report = await fetch(`/v1/imports/${job.id}/error-report`);
    expect(report.headers.get('content-type')).toContain('text/csv');
    expect(report.headers.get('content-disposition')).toContain('attachment');
    const text = await report.text();
    expect(text).toContain('row,problem,Serial Number');
    expect(text).toContain('Room 999');
    const template = await (await fetch('/v1/import-templates/person')).text();
    expect(template).toContain('Name');
    expect(template).toContain('Employee or student number');
    const chromeos = await (
      await fetch('/v1/import-templates/asset?source=google_admin_csv')
    ).text();
    expect(chromeos).toContain('Annotated User');
    expect(typeof downloadErrorReport).toBe('function');
  });

  it('suggests the Google Admin ChromeOS columns', async () => {
    const job = (await importsApi.create({ source: 'google_admin_csv', entity_type: 'asset' }))
      .value;
    const text =
      'Serial Number,Asset ID,Annotated User,Org Unit,Status\n5CG1,AT-1,a@b.org,/Main/Room 101,Provisioned';
    const created = await attachmentsApi.create({
      entity_type: 'import_job',
      entity_id: job.id,
      kind: 'import_file',
      filename: 'chromeos.csv',
      content_type: 'text/csv',
      size_bytes: text.length,
    });
    await putToStorage(created.upload, new Blob([text], { type: 'text/csv' }));
    await attachmentsApi.complete(created.attachment.id);
    await importsApi.update(job.id, { file_attachment_id: created.attachment.id });
    const analysis = await importsApi.analysis(job.id);
    expect(Object.fromEntries(analysis.columns.map((c) => [c.name, c.suggested_field]))).toEqual({
      'Serial Number': 'serial',
      'Asset ID': 'asset_tag',
      'Annotated User': 'assignee',
      'Org Unit': 'location',
      Status: 'status_label',
    });
    const wrongEntity = await fails(
      importsApi.create({ source: 'google_admin_csv', entity_type: 'person' }),
    );
    expect(wrongEntity.status).toBe(422);
  });

  it('saves, lists and deletes column mappings, one name per kind of data', async () => {
    const saved = await importsApi.saveMappingTemplate({
      name: 'Our spreadsheet',
      entity_type: 'asset',
      source: 'csv',
      mapping: { Serial: 'serial' },
    });
    expect(saved).toMatchObject({ name: 'Our spreadsheet', mapping: { Serial: 'serial' } });
    expect((await importsApi.mappingTemplates('asset')).map((t) => t.name)).toEqual([
      'Our spreadsheet',
    ]);
    expect(await importsApi.mappingTemplates('person')).toEqual([]);
    const dup = await fails(
      importsApi.saveMappingTemplate({
        name: 'our SPREADSHEET',
        entity_type: 'asset',
        source: 'csv',
        mapping: {},
      }),
    );
    expect(dup.status).toBe(409);
    await importsApi.deleteMappingTemplate(saved.id);
    expect(await importsApi.mappingTemplates()).toEqual([]);
  });

  it('lists the jobs newest first and filters by state', async () => {
    const first = await draftWith(CSV, 'asset', 'one.csv');
    await draftWith('Name\nScience', 'department', 'two.csv');
    const all = await importsApi.list();
    expect(all.data).toHaveLength(2);
    expect(all.data.map((j) => j.original_filename)).toEqual(['two.csv', 'one.csv']);
    const drafts = await importsApi.list({ state: ['draft'], entity_type: 'asset' });
    expect(drafts.data.map((j) => j.id)).toEqual([first.id]);
    expect((await importsApi.list({ state: ['committed'] })).data).toEqual([]);
  });

  it('needs import:run to start one and import:read to look', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    expect((await importsApi.list()).data).toEqual([]);
    const denied = await fails(importsApi.create({ source: 'csv', entity_type: 'asset' }));
    expect(denied.status).toBe(403);
  });
});
