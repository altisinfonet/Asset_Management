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
  mappingOf,
  newTenancy,
  patchImport,
  registryCounts,
  startImportApp,
  unique,
} from './support.js';

/**
 * What the automated run of the M2 walk-through found in the import (0.2.9): column suggestions of a
 * messy register (BUG-7), the "TOTAL ITEMS" footer (ED-36), the value step and the dry run resolving a
 * name by the same rules (BUG-5, ED-37), a new tag with a taken serial at commit (BUG-6, ED-35) and the
 * assets an import created as a list and label filter (BUG-2, ED-38).
 */
describe.skipIf(!dbEnabled)(`import fixes from the M2 walk-through (${mode})`, () => {
  const tenancy = newTenancy();
  let ih: ImportHarness;
  let t: TenantFixture;
  const admin = () => t.admin;

  beforeAll(async () => {
    ih = await startImportApp();
    t = await createTenant(ih.h.app, tenancy, 'walk');
  });
  afterAll(async () => {
    await ih.h.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const created = async (path: string, body: Json): Promise<Json> => {
    const res = await admin().post(path, body);
    expect(res.status, res.raw).toBe(201);
    return res.body;
  };
  const targetsOf = (job: Json): Record<string, string | null> =>
    Object.fromEntries(
      (job.mapping.columns as Json[]).map((c) => [job.headers[c.index], c.target ?? null]),
    );
  const values = async (id: string, field: string): Promise<Json[]> => {
    const res = await admin().get(`/v1/imports/${id}/values?field=${field}&limit=200`);
    expect(res.status, res.raw).toBe(200);
    return res.body.data;
  };

  it('suggests the columns of a messy register and skips its "TOTAL ITEMS" footer (BUG-7, ED-36)', async () => {
    const file = csv([
      ['Greenfield Public School - IT Inventory', '', '', '', '', '', '', ''],
      [
        'Sr No',
        'Tag No.',
        'Item',
        'Serial #',
        'Type',
        'Date of Purchase',
        'Bought From',
        'Remarks',
      ],
      ['1', 'GPS-001', 'Computer 1', 'WTD-0001', 'Desktops', '2024-03-05', 'Govt. supply', ''],
      ['2', 'GPS-002', 'Printer 2', 'WTD-0002', 'Printers', '2023-01-15', 'Amazon', 'ok'],
      ['', '', '', '', '', '', '', ''],
      ['', 'TOTAL ITEMS: 2', '', '', '', '', '', ''],
    ]);
    const job = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'register.csv',
      body: file,
    });
    expect(targetsOf(job)).toEqual({
      'Sr No': null,
      'Tag No.': 'asset_tag',
      Item: 'name',
      'Serial #': 'serial',
      Type: 'category',
      'Date of Purchase': 'purchase_date',
      'Bought From': 'vendor',
      Remarks: 'notes',
    });
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(dry.counts.dry_run).toMatchObject({ create: 2, skip: 1, error: 0 });
    const rows = await allRows(admin(), job.id);
    const footer = rows.find((r) => r.source['Tag No.'] === 'TOTAL ITEMS: 2')!;
    expect(footer.outcome).toBe('skip');
    expect(footer.warnings).toEqual([
      expect.objectContaining({
        code: 'summary-row',
        message: 'A summary line ("TOTAL ITEMS: 2"), not data; skipped.',
      }),
    ]);
    const done = await commit(ih, admin(), t.tenantId, job.id, dry.dry_run_digest);
    expect(done.counts.commit).toMatchObject({ created: 2, skipped: 1, error: 0 });
    const asset = (await admin().get('/v1/assets?tag=GPS-001&expand=vendor')).body.data[0];
    expect(asset).toMatchObject({ name: 'Computer 1', purchase_date: '2024-03-05' });
    expect(asset.expanded.vendor.name).toBe('Govt. supply');
  });

  it('resolves a bare location name by the same rules on the value step, in the dry run and at commit, whatever the row order (BUG-5, ED-37)', async () => {
    const site = await created('/v1/locations', { name: unique('Bergen'), kind: 'site' });
    await created('/v1/locations', { name: 'Lab 1', kind: 'room', parent_id: site.id });
    const rowsFor = (order: 'bare-first' | 'path-first', tag: string, building: string) => {
      const bare = [`${tag}-1`, 'Laptops', 'Lab 1'];
      const path = [`${tag}-2`, 'Laptops', `${building} / Lab 1`];
      const bare2 = [`${tag}-3`, 'Laptops', 'lab 1'];
      return csv([
        ['Asset Tag', 'Category', 'Location'],
        ...(order === 'bare-first' ? [bare, path, bare2] : [path, bare, bare2]),
      ]);
    };
    const outcomes: Record<string, string[]> = {};
    for (const order of ['bare-first', 'path-first'] as const) {
      const tag = unique('LOC');
      const building = unique('Main Building');
      const job = await analyzed(ih, admin(), t.tenantId, 'asset', {
        filename: `${order}.csv`,
        body: rowsFor(order, tag, building),
      });
      // the value step says what the dry run will say: "Lab 1" is ambiguous, the path is created
      const shown = await values(job.id, 'location');
      const bare = shown.find((v) => v.value === 'Lab 1')!;
      expect(bare.suggestion).toBeNull();
      expect(bare.issue).toMatchObject({ code: 'ambiguous' });
      expect(bare.issue.message).toContain(`"${building} > Lab 1" named in this file`);
      expect(shown.find((v) => v.value === `${building} / Lab 1`)).toMatchObject({
        suggestion: null,
        issue: null,
      });
      const dry = await dryRun(ih, admin(), t.tenantId, job.id);
      const rows = await allRows(admin(), job.id);
      const byTag = (n: number) => rows.find((r) => r.source['Asset Tag'] === `${tag}-${n}`)!;
      outcomes[order] = [1, 2, 3].map(
        (n) => `${byTag(n).outcome}:${byTag(n).errors[0]?.code ?? ''}`,
      );
      expect(byTag(1).errors[0].message).toContain('named in this file');
      const done = await commit(ih, admin(), t.tenantId, job.id, dry.dry_run_digest);
      expect(done.counts.commit).toMatchObject({ created: 1, error: 2 });
    }
    expect(outcomes['bare-first']).toEqual(['error:ambiguous', 'create:', 'error:ambiguous']);
    expect(outcomes['path-first']).toEqual(outcomes['bare-first']);
  });

  it('a bare name that only the import itself creates means that location (ED-37)', async () => {
    const annex = unique('Annex');
    const store = unique('Store');
    const tag = unique('STO');
    const job = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'store.csv',
      body: csv([
        ['Asset Tag', 'Category', 'Location'],
        [`${tag}-1`, 'Laptops', store],
        [`${tag}-2`, 'Laptops', `${annex} > ${store}`],
      ]),
    });
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(dry.counts.dry_run).toMatchObject({ create: 2, error: 0 });
    const before = await registryCounts(t.tenantId);
    await commit(ih, admin(), t.tenantId, job.id, dry.dry_run_digest);
    expect((await registryCounts(t.tenantId)).locations).toBe(before.locations + 2);
    const a1 = (await admin().get(`/v1/assets?tag=${tag}-1`)).body.data[0];
    const a2 = (await admin().get(`/v1/assets?tag=${tag}-2`)).body.data[0];
    expect(a1.location_id).toBe(a2.location_id);
  });

  it("checks a model inside its rows' category on the value step, as the dry run does (BUG-5, ED-37)", async () => {
    const network = await created('/v1/categories', { name: unique('Network equipment') });
    const model = await created('/v1/models', { category_id: network.id, name: unique('UniFi') });
    const other = await created('/v1/categories', { name: unique('Network') });
    const job = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'network.csv',
      body: csv([
        ['Asset Tag', 'Category', 'Model'],
        [unique('NET'), other.name, model.name],
      ]),
    });
    const before = (await values(job.id, 'model'))[0]!;
    expect(before.suggestion).toBeNull();
    expect(before.issue).toMatchObject({ code: 'invalid' });
    expect(before.issue.message).toContain(`already exists in the category "${network.name}"`);
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(dry.counts.dry_run.error).toBe(1);
    expect((await allRows(admin(), job.id))[0]!.errors[0].message).toBe(before.issue.message);
    // mapping the category to the model's category settles it on both screens
    expect(
      (
        await patchImport(admin(), job.id, {
          value_map: { category: { [other.name.toLowerCase()]: { id: network.id } } },
        })
      ).status,
    ).toBe(200);
    const after = (await values(job.id, 'model'))[0]!;
    expect(after).toMatchObject({ issue: null, suggestion: { id: model.id } });
    const dry2 = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(dry2.counts.dry_run).toMatchObject({ create: 1, error: 0 });
  });

  it('refuses a taken serial at commit too, when it was taken after the dry run (BUG-6, ED-35)', async () => {
    const category = await created('/v1/categories', { name: unique('Serial kit') });
    const serial = unique('SN');
    const tag = unique('SER');
    const job = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'serials.csv',
      body: csv([
        ['Asset Tag', 'Serial Number', 'Category'],
        [`${tag}-1`, serial, category.name],
        [`${tag}-2`, unique('SN'), category.name],
      ]),
    });
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(dry.counts.dry_run).toMatchObject({ create: 2, error: 0 });
    // someone registers the serial between the dry run and the commit
    const taker = await created('/v1/assets', { category_id: category.id, serial });
    const done = await commit(ih, admin(), t.tenantId, job.id, dry.dry_run_digest);
    expect(done.counts.commit).toMatchObject({ created: 1, error: 1 });
    const failed = (await allRows(admin(), job.id, '&outcome=error'))[0]!;
    expect(failed.errors[0]).toMatchObject({
      field: 'serial',
      code: 'serial-taken',
      message: `Serial number ${serial} is already used by ${taker.asset_tag}.`,
    });
    expect((await admin().get(`/v1/assets?serial=${serial}`)).body.data).toHaveLength(1);
  });

  it('lists and prints exactly the assets an import created (BUG-2, ED-38)', async () => {
    const existing = await created('/v1/assets', {
      category_id: (await created('/v1/categories', { name: unique('Print kit') })).id,
      asset_tag: unique('OLD'),
    });
    const tag = unique('NEW');
    const job = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'print.csv',
      body: csv([
        ['Asset Tag', 'Category'],
        [`${tag}-1`, 'Laptops'],
        [`${tag}-2`, 'Laptops'],
        [existing.asset_tag, 'Laptops'],
      ]),
    });
    expect(
      (
        await patchImport(admin(), job.id, {
          mapping: mappingOf(job, { 'Asset Tag': 'asset_tag', Category: 'category' }),
        })
      ).status,
    ).toBe(200);
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    const done = await commit(ih, admin(), t.tenantId, job.id, dry.dry_run_digest);
    expect(done.counts.commit).toMatchObject({ created: 2, skipped: 1 });
    const list = await admin().get(`/v1/assets?import_job_id=${job.id}&sort=asset_tag`);
    expect(list.status, list.raw).toBe(200);
    expect(list.body.data.map((a: Json) => a.asset_tag)).toEqual([`${tag}-1`, `${tag}-2`]);
    const batch = await admin().post(
      '/v1/labels/batches',
      { template_key: 'letter-30up-qr', filter: { import_job_id: job.id } },
      { headers: { 'idempotency-key': unique('labels') } },
    );
    expect(batch.status, batch.raw).toBe(202);
    expect(batch.body).toMatchObject({ source: 'filter', asset_count: 2 });
    // an import of another tenant, or none, matches nothing
    const none = await admin().get(`/v1/assets?import_job_id=${crypto.randomUUID()}`);
    expect(none.body.data).toEqual([]);
  });
});
