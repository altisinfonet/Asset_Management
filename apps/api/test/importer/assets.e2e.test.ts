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
  auditRows,
  commit,
  contractViolations,
  createTenant,
  csv,
  dryRun,
  mappingOf,
  newTenancy,
  outboxRows,
  patchImport,
  registryCounts,
  startImportApp,
  unique,
} from './support.js';

/** M2-IMP-01..05: the asset import from file to commit. */
describe.skipIf(!dbEnabled)(`asset import (${mode})`, () => {
  const tenancy = newTenancy();
  let ih: ImportHarness;
  let t: TenantFixture;
  let other: TenantFixture;
  const admin = () => t.admin;

  beforeAll(async () => {
    ih = await startImportApp();
    t = await createTenant(ih.h.app, tenancy, 'imp');
    other = await createTenant(ih.h.app, tenancy, 'imp2');
  });
  afterAll(async () => {
    await ih.h.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const HEADER = [
    'Asset Tag',
    'Serial Number',
    'Name',
    'Category',
    'Manufacturer',
    'Model',
    'Status',
    'Location',
    'Department',
    'Vendor',
    'Purchase Date',
    'Cost',
    'Notes',
  ];

  it('runs the whole flow: analyse, map, dry run (writes nothing), commit, results', async () => {
    const status = (await admin().get('/v1/status-labels?limit=50')).body.data as Array<{
      id: string;
      name: string;
      state_type: string;
    }>;
    const ready = status.find((s) => s.state_type === 'deployable')!;
    const file = csv([
      HEADER,
      [
        '',
        'SN-1001',
        'Anna laptop',
        'Laptops',
        'Dell',
        'Latitude 5440',
        'Ready to deploy',
        'HQ > Building 2 > Room 14',
        'Finance',
        'CDW',
        '2024-03-07',
        '1,249.00',
        '=1+1',
      ],
      [
        '',
        'SN-1002',
        'Bo laptop',
        'Laptops',
        'Dell',
        'Latitude 5440',
        'Ready to deploy',
        'HQ > Building 2',
        'Finance',
        'CDW',
        '2024-03-08',
        '1249',
        '',
      ],
      [
        '',
        'SN-1003',
        '',
        'Workstations',
        'Samsung',
        'QM55B',
        'Ready to deploy',
        'HQ',
        '',
        '',
        '',
        '',
        '',
      ],
      ['', '', 'No serial, no problem', 'Thin clients', '', '', '', '', '', '', '', '', ''],
      ['', 'SN-1001', 'Duplicate of row 1', 'Laptops', '', '', '', '', '', '', '', '', ''],
      [
        '',
        'SN-1005',
        'Bad cost',
        'Laptops',
        '',
        '',
        '',
        '',
        '',
        '',
        'someday',
        'abc',
        '=HYPERLINK("http://evil","x")',
      ],
    ]);
    const job = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'assets.csv',
      body: file,
    });
    expect(job).toMatchObject({
      state: 'analyzed',
      rows_total: 6,
      source: 'csv',
      parse: { format: 'csv', encoding: 'utf-8', delimiter: ',' },
    });
    expect(job.profile).toHaveLength(HEADER.length);
    expect(job.samples).toHaveLength(6);
    // the heuristic got the obvious ones
    const targets = Object.fromEntries(
      job.mapping.columns.map((c: Json) => [job.headers[c.index], c.target]),
    );
    expect(targets).toMatchObject({
      'Serial Number': 'serial',
      Category: 'category',
      Manufacturer: 'manufacturer',
      Model: 'model',
      Status: 'status',
      Location: 'location',
      Department: 'department',
      Vendor: 'vendor',
      'Purchase Date': 'purchase_date',
      Cost: 'purchase_cost',
    });
    expect(job.value_map).toEqual({});

    // the distinct values of a reference column, for the value mapping step
    const values = await admin().get(`/v1/imports/${job.id}/values?field=status`);
    expect(values.status, values.raw).toBe(200);
    expect(values.body.data).toEqual([
      expect.objectContaining({
        value: 'Ready to deploy',
        count: 3,
        suggestion: expect.objectContaining({ id: ready.id }),
      }),
    ]);

    const before = await registryCounts(t.tenantId);
    const done = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(done.state).toBe('dry_run_done');
    expect(done.dry_run_digest).toMatch(/^[0-9a-f]{64}$/);
    // the dry run touched no registry table and wrote no audit row or event other than the import job's
    expect(await registryCounts(t.tenantId)).toEqual(before);
    // 4 creates, 1 skip (duplicate of row 1) and 1 error (bad cost and date)
    expect(
      done.counts.dry_run,
      JSON.stringify((await allRows(admin(), job.id)).map((r) => [r.outcome, r.errors])),
    ).toEqual({ create: 4, update: 0, skip: 1, error: 1 });
    const willCreate = done.summary.will_create.map((w: Json) => w.message);
    expect(willCreate, JSON.stringify(willCreate)).toEqual(
      expect.arrayContaining([
        'Will create category "Workstations"',
        'Will create manufacturer "Dell"',
        'Will create location "HQ > Building 2 > Room 14"',
      ]),
    );

    const rows = await allRows(admin(), job.id);
    expect(rows.map((r) => r.outcome)).toEqual([
      'create',
      'create',
      'create',
      'create',
      'skip',
      'error',
    ]);
    expect(rows[4]!.warnings[0]).toMatchObject({ code: 'duplicate-in-file' });
    expect(rows[4]!.duplicate_of).toBe(1);
    expect(rows[5]!.errors.map((e: Json) => e.field).sort()).toEqual([
      'purchase_cost',
      'purchase_date',
    ]);
    expect(rows[5]!.errors[0].message).toMatch(/not a (date|number)/);
    expect(rows[0]!.source['Serial Number']).toBe('SN-1001');

    // the error report: one line for the bad row, original cells included, spreadsheet-safe
    const report = await admin().get(`/v1/imports/${job.id}/errors.csv`);
    expect(report.status).toBe(200);
    expect(report.raw.startsWith('﻿Row,Line,Fields,Problems,Warnings,Asset Tag')).toBe(true);
    expect(report.raw.split('\r\n').filter(Boolean)).toHaveLength(2);
    expect(report.raw).toContain('purchase_cost');
    // CSV injection: a formula in the file comes back neutralised in the report (and the importer strips it again)
    expect(report.raw).toContain(`"'=HYPERLINK(""http://evil""`);
    expect(report.raw).not.toMatch(/,=HYPERLINK/);

    // commit: stale digest, then the real one
    const stale = await admin().post(
      `/v1/imports/${job.id}/commit`,
      { dry_run_digest: 'a'.repeat(64) },
      { headers: { 'idempotency-key': unique('k1') } },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('import-stale-dry-run');
    const finished = await commit(ih, admin(), t.tenantId, job.id, done.dry_run_digest);
    expect(finished.state).toBe('completed');
    expect(finished.counts.commit).toEqual({ created: 4, updated: 0, skipped: 1, error: 1 });
    expect(finished.progress).toMatchObject({ phase: null, percent: 100 });

    const after = await registryCounts(t.tenantId);
    expect(after.assets).toBe(before.assets + 4);
    expect(after.categories).toBe(before.categories + 2);
    const commitRows = await allRows(admin(), job.id);
    expect(commitRows.map((r) => r.outcome)).toEqual([
      'created',
      'created',
      'created',
      'created',
      'skipped',
      'error',
    ]);
    const created = commitRows[0]!;
    const asset = (
      await admin().get(
        `/v1/assets/${created.created_id}?expand=model,category,location,vendor,department`,
      )
    ).body;
    expect(asset).toMatchObject({
      serial: 'SN-1001',
      name: 'Anna laptop',
      notes: '=1+1',
      purchase_cost: { amount_minor: 124900, currency: 'USD' },
      purchase_date: '2024-03-07',
    });
    expect(asset.expanded.location.name).toBe('Room 14');
    expect(asset.expanded.department.name).toBe('Finance');
    expect(asset.asset_tag).toMatch(/\d{5}$/); // numbered by the template

    // history and audit carry the import job; the batch has its own entry; the event reached the outbox
    const hist = (await admin().get(`/v1/assets/${created.created_id}/history`)).body.data;
    expect(hist[hist.length - 1]).toMatchObject({ event_type: 'created' });
    const audit = await auditRows(t.tenantId, `diff->'meta'->>'import_job_id' = '${job.id}'`);
    expect(audit.some((a) => a.action === 'asset.created')).toBe(true);
    expect(audit.some((a) => a.action === 'import.batch_committed')).toBe(true);
    expect(audit.some((a) => a.action === 'import.completed')).toBe(true);
    const events = await outboxRows(t.tenantId);
    expect(events.filter((e) => e.event_type === 'import.completed')).toHaveLength(1);

    // re-running the same file creates nothing (matched by serial), and says why
    const again = await analyzed(
      ih,
      admin(),
      t.tenantId,
      'asset',
      { filename: 'assets.csv', body: file },
      { options: { match_on: 'serial', on_match: 'update' } },
    );
    const again2 = await patchImport(admin(), again.id, { mapping: again.mapping });
    expect(again2.status).toBe(200);
    const redry = await dryRun(ih, admin(), t.tenantId, again.id);
    expect(redry.counts.dry_run.create).toBe(1); // only the serial-less row has no identity
    expect(redry.counts.dry_run.update + redry.counts.dry_run.skip).toBeGreaterThanOrEqual(3);
  });

  it('refuses a commit before the dry run, edits during a run, and other tenants', async () => {
    const job = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'a.csv',
      body: csv([
        ['Serial', 'Category'],
        ['SN-ST-1', 'Laptops'],
      ]),
    });
    const early = await admin().post(
      `/v1/imports/${job.id}/commit`,
      { dry_run_digest: 'b'.repeat(64) },
      { headers: { 'idempotency-key': unique('early') } },
    );
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ code: 'import-wrong-state', state: 'analyzed' });
    const noKey = await admin().post(`/v1/imports/${job.id}/commit`, {
      dry_run_digest: 'b'.repeat(64),
    });
    expect(noKey.status).toBe(400);
    expect((await other.admin.get(`/v1/imports/${job.id}`)).status).toBe(404);
    expect((await other.admin.get(`/v1/imports/${job.id}/rows`)).status).toBe(404);

    const run = await admin().post(`/v1/imports/${job.id}/dry-run`, {});
    expect(run.status, run.raw).toBe(202);
    const edit = await patchImport(admin(), job.id, { options: { on_match: 'update' } });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('import-wrong-state');
    const done = await (await import('./support.js')).drain(ih, admin(), t.tenantId, job.id);
    expect(done.state).toBe('dry_run_done');
    // an edit after the dry run invalidates it
    const edited = await patchImport(admin(), job.id, { options: { on_match: 'update' } });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ state: 'mapped', dry_run_digest: null });
    const stale = await admin().post(
      `/v1/imports/${job.id}/commit`,
      { dry_run_digest: done.dry_run_digest },
      { headers: { 'idempotency-key': unique('stale') } },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('import-wrong-state');
    // mapping problems are 422 with the message
    const bad = await patchImport(admin(), job.id, {
      mapping: {
        columns: [
          { index: 0, target: 'nope' },
          { index: 1, target: 'serial' },
          { index: 5, target: 'serial' },
        ],
      },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: Json) => e.code)).toEqual(
      expect.arrayContaining(['target', 'duplicate', 'column']),
    );
    // a dry run of a mapping without category is refused up front
    const noCat = await patchImport(admin(), job.id, {
      mapping: mappingOf(job, { Serial: 'serial' }),
    });
    expect(noCat.status).toBe(200);
    const refused = await admin().post(`/v1/imports/${job.id}/dry-run`, {});
    expect(refused.status).toBe(422);
    expect(refused.body.errors[0].message).toMatch(/category/i);
  });
});
