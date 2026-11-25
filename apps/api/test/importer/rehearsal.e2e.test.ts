import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type ImportHarness,
  type Json,
  type TenantFixture,
  allRows,
  analyzed,
  commit,
  contractViolations,
  createTenant,
  csv,
  dryRun,
  newTenancy,
  registryCounts,
  startImportApp,
} from './support.js';

/**
 * ED-29: the dry run rehearses what a first import creates on the way. A row that needs a new
 * category, model, location or department is checked by the facade or the service against the
 * reference created inside a savepoint that is rolled back, so the failures the commit would find are
 * found by the dry run, nothing is written, and no row repeats "checked when committed".
 */
describe.skipIf(!dbEnabled)(`import dry-run rehearsal (${mode})`, { timeout: 120_000 }, () => {
  const tenancy = newTenancy();
  let ih: ImportHarness;
  let t: TenantFixture;
  const admin = () => t.admin;

  beforeAll(async () => {
    // small batches: the rehearsal must hold across batches (references re-created in each)
    ih = await startImportApp({ IMPORT_BATCH_ROWS: '3' });
    t = await createTenant(ih.h.app, tenancy, 'imprh');
  });
  afterAll(async () => {
    await ih.h.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const deferred = (rows: Json[]) =>
    rows.filter((r) => (r.warnings ?? []).some((w: Json) => w.code === 'validated-at-commit'));

  it('checks asset rows against the model, location and category they create, and writes nothing', async () => {
    const cat = (await admin().get('/v1/categories?q=Laptops')).body.data[0];
    const field = await admin().post('/v1/custom-fields', {
      key: 'rh_asset_owner',
      label: 'Asset owner',
      data_type: 'text',
      category_id: cat.id,
      required: true,
    });
    expect(field.status, field.raw).toBe(201);
    const body = csv([
      ['Serial', 'Asset tag', 'Category', 'Model', 'Location', 'Asset owner'],
      // an existing category, a new model and location: the required field is missing -> predicted
      ['RH-1', 'RH-001', 'Laptops', 'Rehearsal Book 1', 'Rehearsal Hall > Room 1', ''],
      ['RH-2', 'RH-002', 'Laptops', 'Rehearsal Book 1', 'Rehearsal Hall > Room 1', 'Ana'],
      // a new category: nothing is required in it
      ['RH-3', 'RH-003', 'Rehearsal Gadgets', 'Gadget 1', 'Rehearsal Hall > Room 2', ''],
      ['RH-4', 'RH-004', 'Rehearsal Gadgets', 'Gadget 1', 'Rehearsal Hall > Room 2', ''],
      ['RH-5', 'RH-005', 'Laptops', 'Rehearsal Book 1', 'Rehearsal Hall > Room 1', 'Ben'],
    ]);
    const job = await analyzed(ih, admin(), t.tenantId, 'asset', { filename: 'rh.csv', body });
    expect(job.state, job.error ?? '').toBe('analyzed');
    const before = await registryCounts(t.tenantId);
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(dry.counts.dry_run).toEqual({ create: 4, update: 0, skip: 0, error: 1 });
    // the rehearsal is rolled back: not a category, model, location, audit row or event is left
    expect(await registryCounts(t.tenantId)).toEqual(before);
    const rows = await allRows(admin(), job.id);
    expect(rows[0]!.plan).toBe('error');
    expect(rows[0]!.errors[0]).toMatchObject({ field: 'cf:rh_asset_owner' });
    // no row says it is checked later, and what is created on the way is still announced
    expect(deferred(rows)).toEqual([]);
    expect(dry.summary.validated_at_commit).toBe(0);
    const announced = (dry.summary.will_create as Json[]).map((w) => w.message).sort();
    expect(announced).toEqual(
      expect.arrayContaining([
        'Will create category "Rehearsal Gadgets"',
        'Will create model "Rehearsal Book 1"',
        'Will create location "Rehearsal Hall > Room 1"',
      ]),
    );

    // the commit agrees with the dry run, row for row (the rejected row stays the one error)
    const fin = await commit(ih, admin(), t.tenantId, job.id, dry.dry_run_digest);
    expect(fin.counts.commit).toEqual({ created: 4, updated: 0, skipped: 0, error: 1 });
    const results = (await allRows(admin(), job.id)).map((r) => r.result ?? r.plan);
    expect(results.slice(1)).toEqual(['created', 'created', 'created', 'created']);
    const after = await registryCounts(t.tenantId);
    expect(after.assets).toBe(before.assets + 4);
    expect(after.categories).toBe(before.categories + 1);
    expect(after.models).toBe(before.models + 2);
  });

  it('checks people against the department they create: a taken email is found by the dry run', async () => {
    const taken = await admin().post('/v1/people', {
      display_name: 'Already Here',
      email: 'rh.taken@example.test',
    });
    expect(taken.status, taken.raw).toBe(201);
    const body = csv([
      ['Name', 'Email', 'Department'],
      ['Cleo New', 'rh.cleo@example.test', 'Rehearsal Drama'],
      ['Dup Person', 'RH.Taken@example.test', 'Rehearsal Drama'],
    ]);
    const job = await analyzed(ih, admin(), t.tenantId, 'person', {
      filename: 'people.csv',
      body,
    });
    const before = await registryCounts(t.tenantId);
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(await registryCounts(t.tenantId)).toEqual(before);
    const rows = await allRows(admin(), job.id);
    // matching is on the email: the second row is the existing person (skip), not a new one
    expect(rows.map((r) => r.plan)).toEqual(['create', 'skip']);
    expect(deferred(rows)).toEqual([]);
    expect((dry.summary.will_create as Json[]).map((w) => w.message)).toEqual([
      'Will create department "Rehearsal Drama"',
    ]);
    const fin = await commit(ih, admin(), t.tenantId, job.id, dry.dry_run_digest);
    expect(fin.counts.commit).toMatchObject({ created: 1, error: 0 });
  });

  it('counts the location rows whose checks wait for the commit once, in the summary', async () => {
    const body = csv([['Path'], ['Rehearsal Campus > Block A'], ['Rehearsal Campus > Block B']]);
    const job = await analyzed(ih, admin(), t.tenantId, 'location', {
      filename: 'places.csv',
      body,
    });
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(dry.counts.dry_run).toMatchObject({ create: 2, error: 0 });
    expect(dry.summary.validated_at_commit).toBe(2);
    const rows = await allRows(admin(), job.id);
    expect(deferred(rows)).toHaveLength(2);
    expect(deferred(rows)[0]!.warnings).toContainEqual(
      expect.objectContaining({
        code: 'validated-at-commit',
        message: 'Checked when the import runs (a record it needs is created on the way).',
      }),
    );
  });
});
