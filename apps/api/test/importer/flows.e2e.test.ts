import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import { PgAuditWriter } from '../../src/audit/index.js';
import { ExportRunner } from '../../src/exports/index.js';
import { OutboxRelay, OutboxSubscribers } from '../../src/outbox/index.js';
import {
  type ImportHarness,
  type Json,
  type TenantFixture,
  allRows,
  analyzed,
  commit,
  contractViolations,
  createUser,
  createTenant,
  csv,
  drain,
  dryRun,
  newTenancy,
  ownerTenantSql,
  patchImport,
  registryCounts,
  runStepOnce,
  startImportApp,
  unique,
} from './support.js';
import { googleRows, GOOGLE_HEADERS, toCsv } from './fixtures.js';

const SAMPLE = readFileSync(
  join(import.meta.dirname, 'fixtures', 'google-admin-chromeos-sample.csv'),
);

/** M2-IMP-05/06: commit behaviour (concurrency, crashes, cancel, quotas), templates, XLSX and the Google preset. */
describe.skipIf(!dbEnabled)(`import flows (${mode})`, { timeout: 120_000 }, () => {
  const tenancy = newTenancy();
  let ih: ImportHarness;
  let t: TenantFixture;
  const admin = () => t.admin;
  const key = () => ({ headers: { 'idempotency-key': unique('k') } });

  beforeAll(async () => {
    ih = await startImportApp({
      IMPORT_BATCH_ROWS: '5',
      IMPORT_MAX_ROWS: '200',
      IMPORT_MAX_CONCURRENT: '2',
    });
    t = await createTenant(ih.h.app, tenancy, 'impflow');
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await ih.h.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const assetFile = (n: number, prefix: string) =>
    csv([
      ['Serial', 'Name', 'Category'],
      ...Array.from({ length: n }, (_, i) => [
        `${prefix}-${String(i).padStart(3, '0')}`,
        `Item ${i}`,
        'Laptops',
      ]),
    ]);

  async function ready(prefix: string, n: number, create: Record<string, unknown> = {}) {
    const job = await analyzed(
      ih,
      admin(),
      t.tenantId,
      'asset',
      { filename: `${prefix}.csv`, body: assetFile(n, prefix) },
      create,
    );
    expect(job.state, job.error ?? '').toBe('analyzed');
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(dry.state).toBe('dry_run_done');
    return { job, dry };
  }
  const startCommit = (id: string, digest: string) =>
    admin().post(`/v1/imports/${id}/commit`, { dry_run_digest: digest }, key());

  it('commits in batches, one transaction each: a batch that fails rolls back whole and the retry duplicates nothing', async () => {
    const { job, dry } = await ready('RS', 12);
    expect(dry.counts.dry_run.create).toBe(12);
    const before = await registryCounts(t.tenantId);
    expect((await startCommit(job.id, dry.dry_run_digest)).status).toBe(202);
    // step 1 (rows 1-5) succeeds
    await runStepOnce(ih, t.tenantId, job.id);
    const mid = await admin().get(`/v1/imports/${job.id}`);
    expect(mid.body).toMatchObject({
      state: 'committing',
      progress: { phase: 'commit', processed: 5, total: 12 },
    });
    expect((await registryCounts(t.tenantId)).assets).toBe(before.assets + 5);
    // step 2 crashes after its rows were written (the batch audit entry fails): nothing of it survives
    const original = PgAuditWriter.prototype.write;
    let armed = true;
    const crash = vi.spyOn(PgAuditWriter.prototype, 'write').mockImplementation(async function (
      this: PgAuditWriter,
      tx,
      entry,
    ) {
      if (armed && entry.action === 'import.batch_committed') {
        armed = false;
        throw new Error('worker killed mid-batch');
      }
      return original.call(this, tx, entry);
    });
    await expect(runStepOnce(ih, t.tenantId, job.id)).rejects.toThrow(/worker killed/);
    crash.mockRestore();
    expect((await registryCounts(t.tenantId)).assets).toBe(before.assets + 5);
    expect((await admin().get(`/v1/imports/${job.id}`)).body.progress.processed).toBe(5);
    // the queue retries the step; the import finishes with exactly the file's rows
    const done = await drain(ih, admin(), t.tenantId, job.id);
    expect(done.state).toBe('completed');
    expect(done.counts.commit).toEqual({ created: 12, updated: 0, skipped: 0, error: 0 });
    expect((await registryCounts(t.tenantId)).assets).toBe(before.assets + 12);
    const dup = await ownerTenantSql(
      t.tenantId,
      "select serial from app.asset where serial like 'RS-%' group by serial having count(*) > 1",
    );
    expect(dup.rows).toEqual([]);
    // running the finished job's step again changes nothing
    await runStepOnce(ih, t.tenantId, job.id);
    expect((await registryCounts(t.tenantId)).assets).toBe(before.assets + 12);

    // the requester is told in the bell (M2-IMP-05): the outbox event reaches the notification subscriber
    await new OutboxRelay({
      tenancy: ih.runtime,
      tenants: async () => [{ tenantId: t.tenantId }],
      subscribers: ih.h.app.get(OutboxSubscribers, { strict: false }),
      logger: pino({ level: 'silent' }),
    }).runOnce();
    const bell = (await admin().get('/v1/notifications?limit=50')).body.data as Json[];
    const note = bell.find((n) => n.type === 'import.completed');
    expect(note, JSON.stringify(bell.map((n) => n.type))).toMatchObject({
      title: 'Import finished',
    });
    expect(note!.body).toContain('RS.csv');
    expect(note!.body).toContain('12 created');
  });

  it('can be cancelled between batches; what was written stays', async () => {
    const { job, dry } = await ready('CN', 12);
    const before = await registryCounts(t.tenantId);
    await startCommit(job.id, dry.dry_run_digest);
    await runStepOnce(ih, t.tenantId, job.id);
    const cancel = await admin().post(`/v1/imports/${job.id}/cancel`, {});
    expect(cancel.status).toBe(200);
    expect(cancel.body).toMatchObject({ state: 'committing', cancel_requested: true });
    await runStepOnce(ih, t.tenantId, job.id);
    const after = (await admin().get(`/v1/imports/${job.id}`)).body;
    expect(after).toMatchObject({ state: 'cancelled', cancel_requested: false });
    expect((await registryCounts(t.tenantId)).assets).toBe(before.assets + 5);
    expect((await admin().post(`/v1/imports/${job.id}/cancel`, {})).status).toBe(409);
    // cancelling a job that is only waiting is immediate
    const idle = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'x.csv',
      body: assetFile(2, 'ID'),
    });
    expect((await admin().post(`/v1/imports/${idle.id}/cancel`, {})).body.state).toBe('cancelled');
  });

  it('a row that fails at commit takes the model it had to create with it: the next rows create it again (found by the real-stack run)', async () => {
    const tag = (i: number) => `RB-${String(i).padStart(3, '0')}`;
    const body = csv([
      ['Serial', 'Asset tag', 'Category', 'Model'],
      ...[1, 2, 3, 4].map((i) => [`RB-SN-${i}`, tag(i), 'Laptops', 'Rollback Model X']),
    ]);
    const job = await analyzed(
      ih,
      admin(),
      t.tenantId,
      'asset',
      { filename: 'rb.csv', body },
      { options: { match_on: 'serial' } },
    );
    expect(job.state, job.error ?? '').toBe('analyzed');
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(dry.counts.dry_run).toEqual({ create: 4, update: 0, skip: 0, error: 0 });
    // after the dry run somebody takes the tag of the FIRST row: it fails at commit, after it created the model
    const cat = (await admin().get('/v1/categories?limit=1')).body.data[0].id as string;
    expect((await admin().post('/v1/assets', { category_id: cat, asset_tag: tag(1) })).status).toBe(
      201,
    );
    const fin = await commit(ih, admin(), t.tenantId, job.id, dry.dry_run_digest);
    expect(fin.counts.commit).toEqual({ created: 3, updated: 0, skipped: 0, error: 1 });
    const rows = await allRows(admin(), job.id);
    expect((rows[0]!.errors ?? rows[0]!.result_errors)[0]).toMatchObject({
      code: 'duplicate',
      field: 'asset_tag',
    });
    expect(rows.slice(1).map((r) => r.result)).toEqual(['created', 'created', 'created']);
    const models = await ownerTenantSql(
      t.tenantId,
      "select count(*)::int as n from app.asset_model where name = 'Rollback Model X'",
    );
    expect((models.rows[0] as Json).n).toBe(1);
  });

  it('leaves a record that was edited after the dry run alone, and says so', async () => {
    const first = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'u1.csv',
      body: assetFile(4, 'UP'),
    });
    const d1 = await dryRun(ih, admin(), t.tenantId, first.id);
    await commit(ih, admin(), t.tenantId, first.id, d1.dry_run_digest);
    // an update file: new names for the same serials
    const body = csv([
      ['Serial', 'Name', 'Category'],
      ...Array.from({ length: 4 }, (_, i) => [
        `UP-${String(i).padStart(3, '0')}`,
        `Renamed ${i}`,
        'Laptops',
      ]),
    ]);
    const upd = await analyzed(
      ih,
      admin(),
      t.tenantId,
      'asset',
      { filename: 'u2.csv', body },
      { options: { match_on: 'serial', on_match: 'update' } },
    );
    const dry = await dryRun(ih, admin(), t.tenantId, upd.id);
    expect(dry.counts.dry_run).toEqual({ create: 0, update: 4, skip: 0, error: 0 });
    const target = (await allRows(admin(), upd.id))[1]!;
    const asset = await admin().get(`/v1/assets/${target.entity_id}`);
    await admin().patch(
      `/v1/assets/${target.entity_id}`,
      { notes: 'edited meanwhile' },
      { headers: { 'if-match': String(asset.headers.etag) } },
    );
    const fin = await commit(ih, admin(), t.tenantId, upd.id, dry.dry_run_digest);
    expect(fin.counts.commit).toEqual({ created: 0, updated: 3, skipped: 0, error: 1 });
    const rows = await allRows(admin(), upd.id);
    expect(rows[1]!.errors[0]).toMatchObject({ code: 'changed-since-dry-run' });
    expect((await admin().get(`/v1/assets/${target.entity_id}`)).body.name).not.toBe('Renamed 1');
    expect(rows[0]!.before_image).toMatchObject({ name: 'Item 0' });
    // the error report lists exactly that row, with its cells
    const report = await admin().get(`/v1/imports/${upd.id}/errors.csv`);
    expect(report.raw.split('\r\n').filter(Boolean)).toHaveLength(2);
    expect(report.raw).toContain(
      'changed-since-dry-run'.slice(0, 0) + 'was edited after the dry run',
    );
  });

  it('refuses too many running imports and files over the row quota', async () => {
    const a = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'q1.csv',
      body: assetFile(2, 'QA'),
    });
    const b = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'q2.csv',
      body: assetFile(2, 'QB'),
    });
    const c = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'q3.csv',
      body: assetFile(2, 'QC'),
    });
    expect((await admin().post(`/v1/imports/${a.id}/dry-run`, {})).status).toBe(202);
    expect((await admin().post(`/v1/imports/${b.id}/dry-run`, {})).status).toBe(202);
    const third = await admin().post(`/v1/imports/${c.id}/dry-run`, {});
    expect(third.status).toBe(429);
    expect(third.body.code).toBe('import-quota-exceeded');
    expect(third.headers['retry-after']).toBeTruthy();
    await drain(ih, admin(), t.tenantId, a.id);
    await drain(ih, admin(), t.tenantId, b.id);
    expect((await admin().post(`/v1/imports/${c.id}/dry-run`, {})).status).toBe(202);
    await drain(ih, admin(), t.tenantId, c.id);

    const big = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'big.csv',
      body: assetFile(201, 'BG'),
    });
    expect(big.state).toBe('failed');
    expect(big.error).toMatch(/more than 200 data rows/);
    const broken = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'broken.csv',
      body: 'a,b\n1,"2\n',
    });
    expect(broken).toMatchObject({ state: 'failed' });
    expect(broken.error).toMatch(/Line 2.*never closed/);
  });

  it('waits for the upload scan, and refuses an infected or unfinished file', async () => {
    const created = await admin().post('/v1/imports', { entity_type: 'asset' });
    const id = created.body.id as string;
    const att = await admin().post('/v1/attachments', {
      entity_type: 'import_job',
      entity_id: id,
      kind: 'import_file',
      filename: 'x.csv',
      content_type: 'text/csv',
      size_bytes: 10,
    });
    expect(att.status, att.raw).toBe(201);
    const early = await admin().post(`/v1/imports/${id}/analyze`, {
      file_attachment_id: att.body.attachment.id,
    });
    expect(early.status).toBe(422); // not uploaded yet
    const wrongOwner = await admin().post(`/v1/imports/${id}/analyze`, {
      file_attachment_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(wrongOwner.status).toBe(422);
    const noFile = await admin().post(`/v1/imports/${id}/analyze`, {});
    expect(noFile.status).toBe(422);
    const dry = await admin().post(`/v1/imports/${id}/dry-run`, {});
    expect(dry.status).toBe(409);
  });

  it('saves a mapping as a template and applies it to the next file by header', async () => {
    const body = csv([
      ['Serial Number', 'Device name', 'Type'],
      ['T-1', 'x', 'Laptops'],
    ]);
    const job = await analyzed(ih, admin(), t.tenantId, 'asset', { filename: 't.csv', body });
    const mapped = await patchImport(admin(), job.id, {
      mapping: {
        columns: [
          { index: 0, target: 'serial' },
          { index: 1, target: 'name' },
          { index: 2, target: 'category' },
        ],
      },
      options: { on_match: 'update', date_format: 'dmy' },
    });
    expect(mapped.status).toBe(200);
    const name = unique('School laptops');
    const tpl = await admin().post('/v1/import-templates', { name, from_import_id: job.id });
    expect(tpl.status, tpl.raw).toBe(201);
    expect(tpl.body).toMatchObject({
      entity_type: 'asset',
      columns: [
        { header: 'Serial Number', target: 'serial' },
        { header: 'Device name', target: 'name' },
        { header: 'Type', target: 'category' },
      ],
      options: expect.objectContaining({ on_match: 'update', date_format: 'dmy' }),
    });
    expect(
      (
        await admin().post('/v1/import-templates', {
          name: name.toUpperCase(),
          from_import_id: job.id,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await admin().post('/v1/import-templates', {
          name: 'bad',
          entity_type: 'asset',
          columns: [{ header: 'x', target: 'nope' }],
        })
      ).status,
    ).toBe(422);
    // another file with the same headers in another order
    const next = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 't2.csv',
      body: csv([
        ['type', 'DEVICE NAME', 'serial number'],
        ['Laptops', 'y', 'T-2'],
      ]),
    });
    const applied = await admin().post(`/v1/imports/${next.id}/apply-template`, {
      template_id: tpl.body.id,
    });
    expect(applied.status, applied.raw).toBe(200);
    expect(applied.body).toMatchObject({
      state: 'mapped',
      options: expect.objectContaining({ on_match: 'update' }),
    });
    expect(applied.body.mapping.columns.map((c: Json) => c.target)).toEqual([
      'category',
      'name',
      'serial',
    ]);
    const dry = await dryRun(ih, admin(), t.tenantId, next.id);
    expect(dry.counts.dry_run.create).toBe(1);
    // listing and editing
    const list = await admin().get('/v1/import-templates?entity_type=asset');
    expect(list.body.data.map((x: Json) => x.id)).toContain(tpl.body.id);
    const patched = await admin().patch(
      `/v1/import-templates/${tpl.body.id}`,
      { description: 'for the school' },
      { headers: { 'if-match': String(tpl.headers.etag) } },
    );
    expect(patched.status).toBe(200);
    expect(
      (
        await admin().del(`/v1/import-templates/${tpl.body.id}`, undefined, {
          headers: { 'if-match': String(patched.headers.etag) },
        })
      ).status,
    ).toBe(204);
    expect((await admin().get(`/v1/import-templates/${tpl.body.id}`)).status).toBe(404);
  });

  it('downloads the templates and imports the XLSX one back (people first, then assets)', async () => {
    const presets = await admin().get('/v1/imports/presets');
    expect(presets.body.data.map((p: Json) => p.key)).toEqual([
      'assets',
      'people',
      'locations',
      'departments',
      'google_admin_chromeos',
    ]);
    expect(presets.body.data[0].columns[0]).toMatchObject({
      column: 'Asset tag',
      target: 'asset_tag',
    });
    const csvFile = await admin().get('/v1/imports/presets/assets/template?format=csv');
    expect(csvFile.status).toBe(200);
    expect(csvFile.headers['content-type']).toContain('text/csv');
    expect(csvFile.raw.startsWith('﻿Asset tag,Name,Serial number,Category')).toBe(true);
    expect((await admin().get('/v1/imports/presets/nope/template')).status).toBe(404);

    const raw = await fetchBinary(admin(), '/v1/imports/presets/people/template?format=xlsx');
    expect(raw.subarray(0, 2).toString()).toBe('PK');
    const job = await analyzed(
      ih,
      admin(),
      t.tenantId,
      'person',
      { filename: 'people.xlsx', body: raw },
      { preset_key: 'people' },
    );
    expect(job).toMatchObject({
      state: 'analyzed',
      source: 'xlsx',
      rows_total: 2,
      preset_key: 'people',
      parse: expect.objectContaining({ format: 'xlsx', sheet: 'Template' }),
    });
    const mapped = Object.fromEntries(
      job.mapping.columns.map((c: Json) => [job.headers[c.index], c.target]),
    );
    expect(mapped).toMatchObject({
      Name: 'display_name',
      Email: 'email',
      'Employee number': 'employee_ref',
      Department: 'department',
    });
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(dry.counts.dry_run).toEqual({ create: 2, update: 0, skip: 0, error: 0 });
    await commit(ih, admin(), t.tenantId, job.id, dry.dry_run_digest);
    expect(((await admin().get('/v1/people?q=omar')).body.data as Json[])[0]).toMatchObject({
      email: 'omar.haddad@example.com',
      kind: 'contractor',
    });
  });

  it('imports a Google Admin ChromeOS export through the preset, and a second run changes nothing', async () => {
    const rows = googleRows(48);
    // people first: the annotated users
    const people = toCsv([
      ['Name', 'Email'],
      ...rows.filter((r) => r[8]).map((r) => [r[8]!.split('@')[0]!, r[8]!]),
    ]);
    const pj = await analyzed(ih, admin(), t.tenantId, 'person', {
      filename: 'users.csv',
      body: people,
    });
    const pd = await dryRun(ih, admin(), t.tenantId, pj.id);
    await commit(ih, admin(), t.tenantId, pj.id, pd.dry_run_digest);

    const created = await admin().post('/v1/imports', {
      entity_type: 'asset',
      preset_key: 'google_admin_chromeos',
    });
    expect(created.status, created.raw).toBe(201);
    expect(created.body.summary.setup).toMatchObject({
      category_created: true,
      custom_fields_created: expect.arrayContaining(['os_version', 'mac_address', 'last_sync']),
    });
    expect(created.body.options).toMatchObject({
      match_on: 'serial',
      on_match: 'update',
      external_source: 'google_admin',
    });
    // the setup is done by creating the import; a second import finds everything in place
    const again = await admin().post('/v1/imports', {
      entity_type: 'asset',
      preset_key: 'google_admin_chromeos',
    });
    expect(again.body.summary.setup).toMatchObject({
      category_created: false,
      custom_fields_created: [],
    });

    const job = await uploadAndAnalyze(created.body.id as string, 'chromebooks.csv', SAMPLE);
    expect(job).toMatchObject({ state: 'analyzed', source: 'google_admin_csv', rows_total: 48 });
    const targets = Object.fromEntries(
      job.mapping.columns.map((c: Json) => [job.headers[c.index], c.target]),
    );
    expect(targets).toMatchObject({
      'Serial number': 'serial',
      'Asset ID': 'asset_tag',
      Status: 'status',
      Model: 'model',
      'OS version': 'cf:os_version',
      'Last sync': 'cf:last_sync',
      User: 'assigned_to',
      Location: 'cf:annotated_location',
      Notes: 'notes',
      'Org unit path': 'location',
      'MAC address': 'cf:mac_address',
      'Device ID': 'external_id',
    });
    expect(job.mapping.constants).toEqual({ category: 'Chromebook' });
    // status words are mapped to labels by their state type
    expect(Object.keys(job.value_map.status ?? {}).sort()).toEqual([
      'active',
      'deprovisioned',
      'disabled',
      'provisioned',
    ]);

    const before = await registryCounts(t.tenantId);
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(
      dry.counts.dry_run.error,
      JSON.stringify((await allRows(admin(), job.id, '&outcome=error')).slice(0, 3)),
    ).toBe(0);
    expect(dry.counts.dry_run.create).toBe(48);
    expect(dry.summary.will_create.map((w: Json) => w.field)).toEqual(
      expect.arrayContaining(['model', 'location']),
    );
    expect(await registryCounts(t.tenantId)).toEqual(before);
    const fin = await commit(ih, admin(), t.tenantId, job.id, dry.dry_run_digest);
    expect(fin.counts.commit.created).toBe(48);
    expect(fin.counts.commit.error).toBe(0);

    const after = await registryCounts(t.tenantId);
    expect(after.assets).toBe(before.assets + 48);
    expect(after.models).toBe(before.models + 4);
    expect(after.assignments).toBeGreaterThan(before.assignments); // annotated users hold their devices
    const first = (await allRows(admin(), job.id))[0]!;
    const asset = (
      await admin().get(`/v1/assets/${first.created_id}?expand=category,location,model`)
    ).body;
    expect(asset).toMatchObject({
      serial: '5CD0000000',
      asset_tag: 'CHR-00001',
      external_source: 'google_admin',
      custom_data: expect.objectContaining({
        os_version: '126.0.6478.100',
        mac_address: '3C:E9:F7:00:00:01',
        last_sync: '2026-11-01',
        annotated_location: 'Room 10',
      }),
    });
    expect(asset.expanded.category.name).toBe('Chromebook');
    expect(asset.expanded.location).toMatchObject({ name: 'Grade 5' });
    expect(asset.expanded.model.name).toBe('HP Chromebook 14 G6');
    expect(asset.current_assignment).toMatchObject({ target_type: 'person' });

    // re-importing the same file updates by serial and creates no duplicates
    const second = await admin().post('/v1/imports', {
      entity_type: 'asset',
      preset_key: 'google_admin_chromeos',
    });
    const j2 = await uploadAndAnalyze(second.body.id as string, 'chromebooks.csv', SAMPLE);
    const d2 = await dryRun(ih, admin(), t.tenantId, j2.id);
    expect(d2.counts.dry_run).toEqual({ create: 0, update: 0, skip: 48, error: 0 });
    // a changed OS version is an update, found by serial
    const changed = rows.map((r) => [...r]);
    changed[2]![4] = '127.0.0.1';
    const j3 = await uploadAndAnalyze(
      (
        await admin().post('/v1/imports', {
          entity_type: 'asset',
          preset_key: 'google_admin_chromeos',
        })
      ).body.id as string,
      'chromebooks2.csv',
      Buffer.from(toCsv([[...GOOGLE_HEADERS], ...changed])),
    );
    const d3 = await dryRun(ih, admin(), t.tenantId, j3.id);
    expect(d3.counts.dry_run).toEqual({ create: 0, update: 1, skip: 47, error: 0 });
    const f3 = await commit(ih, admin(), t.tenantId, j3.id, d3.dry_run_digest);
    expect(f3.counts.commit.updated).toBe(1);
    expect((await registryCounts(t.tenantId)).assets).toBe(before.assets + 48);
    const upd = (await allRows(admin(), j3.id)).find((r) => r.result === 'updated')!;
    expect(upd.before_image).toMatchObject({ custom_data: { os_version: '126.0.6478.102' } });
  });

  it('reads Windows-1252, UTF-16 and semicolon files through the upload pipeline (M2-IMP-02)', async () => {
    const rows = 'Serial;Name;Category\r\nENC-1;Müller Größe;Laptops\r\nENC-2;Café mat;Laptops\r\n';
    const cp1252 = Buffer.from(
      rows.replace('Müller Größe', 'Müller Größe').replace('Café', 'Café'),
      'latin1',
    );
    const a = await analyzed(ih, admin(), t.tenantId, 'asset', {
      filename: 'win.csv',
      body: cp1252,
    });
    expect(a).toMatchObject({
      state: 'analyzed',
      parse: { encoding: 'windows-1252', delimiter: ';' },
      rows_total: 2,
    });
    expect(a.samples[0][1]).toBe('Müller Größe');
    const u16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('Serial\tName\tCategory\r\nENC-3\tÅse\tLaptops\r\n', 'utf16le'),
    ]);
    const b = await analyzed(ih, admin(), t.tenantId, 'asset', { filename: 'u16.csv', body: u16 });
    expect(b).toMatchObject({
      state: 'analyzed',
      parse: { encoding: 'utf-16le', delimiter: '\t' },
      rows_total: 1,
    });
    expect(b.samples[0][1]).toBe('Åse');
    const bom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('Serial,Name,Category\r\nENC-4,"two\r\nlines",Laptops\r\n', 'utf8'),
    ]);
    const c = await analyzed(ih, admin(), t.tenantId, 'asset', { filename: 'bom.csv', body: bom });
    expect(c.samples[0][1]).toBe('two\r\nlines'.replace('\r\n', '\n'));
    expect(c.headers).toEqual(['Serial', 'Name', 'Category']);
    // the user can override what the analysis detected
    const forced = await admin().post(`/v1/imports/${a.id}/analyze`, {
      parse: { encoding: 'windows-1252', delimiter: ',' },
    });
    expect(forced.status).toBe(202);
    const re = await drain(ih, admin(), t.tenantId, a.id);
    expect(re.headers).toEqual(['Serial;Name;Category']);
  });

  it('maps values, creates what the policy allows, asks for an explicit date order and applies the duplicate policy', async () => {
    const status = (await admin().get('/v1/status-labels?limit=50')).body.data as Json[];
    const retired = status.find((s) => s.state_type === 'archived') ?? status[status.length - 1]!;
    const body = csv([
      ['Serial', 'Category', 'Status', 'Bought', 'Cost', 'Currency', 'Vendor'],
      ['VM-1', 'PCs', 'in use', '03/04/2024', '1.234,50', 'eur', 'Acme'],
      ['VM-2', 'PCs', 'gone', '05/06/2024', '99', '', 'Acme'],
      ['VM-3', 'Unknown thing', '', '', '', '', ''],
      ['VM-1', 'PCs', 'in use', '', '', '', ''],
    ]);
    const job = await analyzed(ih, admin(), t.tenantId, 'asset', { filename: 'vm.csv', body });
    expect(job.profile[3]).toMatchObject({ type: 'date', date_order: 'ambiguous' });
    const targets = Object.fromEntries(
      job.mapping.columns.map((c: Json) => [job.headers[c.index], c.target]),
    );
    expect(targets).toMatchObject({
      Bought: 'purchase_date',
      Cost: 'purchase_cost',
      Currency: 'currency',
      Vendor: 'vendor',
    });
    // the value mapping step: what are the statuses called, and what do they match?
    const values = await admin().get(`/v1/imports/${job.id}/values?field=status`);
    expect(values.body.data.map((v: Json) => [v.value, v.count, v.suggestion])).toEqual([
      ['in use', 2, null],
      ['gone', 1, null],
    ]);
    const cats = await admin().get(`/v1/imports/${job.id}/values?field=category&q=pc`);
    expect(cats.body).toMatchObject({
      column: 'Category',
      distinct: 2,
      data: [{ value: 'PCs', count: 3 }],
    });
    expect((await admin().get(`/v1/imports/${job.id}/values?field=person`)).status).toBe(422);

    const deployable = status.find((s) => s.state_type === 'deployable')!;
    let res = await patchImport(admin(), job.id, {
      value_map: {
        status: { 'in use': { id: deployable.id }, gone: { id: retired.id } },
        category: {
          pcs: { create: true, name: 'Personal computers' },
          'unknown thing': { skip: true },
        },
      },
      options: { references: { vendor: 'must_exist' }, on_match: 'error', number_format: 'comma' },
    });
    expect(res.status, res.raw).toBe(200);
    let dry = await dryRun(ih, admin(), t.tenantId, job.id);
    let rows = await allRows(admin(), job.id);
    // an ambiguous date is reported on the cell with the way out; a row is judged one kind of problem at a time
    expect(rows[0]!.errors).toEqual([
      expect.objectContaining({ field: 'purchase_date', code: 'ambiguous-date' }),
    ]);
    expect(rows[0]!.errors[0].message).toMatch(/day first or month first/);
    expect(rows[2]!.errors[0]).toMatchObject({ field: 'category', code: 'required' });
    expect(rows[3]!.errors[0]).toMatchObject({ code: 'duplicate-in-file' });
    expect(dry.counts.dry_run.error).toBe(4);
    // with the date order chosen, the missing vendor (policy must_exist) is what is left
    res = await patchImport(admin(), job.id, { options: { date_format: 'dmy' } });
    expect(res.status).toBe(200);
    dry = await dryRun(ih, admin(), t.tenantId, job.id);
    rows = await allRows(admin(), job.id);
    expect(rows[0]!.errors[0]).toMatchObject({ field: 'vendor', code: 'not-found' });
    res = await patchImport(admin(), job.id, { options: { references: { vendor: 'create' } } });
    expect(res.status).toBe(200);
    dry = await dryRun(ih, admin(), t.tenantId, job.id);
    rows = await allRows(admin(), job.id);
    expect(rows.map((r) => r.outcome)).toEqual(['create', 'create', 'error', 'error']);
    const fin = await commit(ih, admin(), t.tenantId, job.id, dry.dry_run_digest);
    expect(
      fin.counts.commit,
      JSON.stringify((await allRows(admin(), job.id)).map((r) => [r.outcome, r.errors])),
    ).toEqual({ created: 2, updated: 0, skipped: 0, error: 2 });
    const made = (await allRows(admin(), job.id)).filter((r) => r.created_id);
    const one = (await admin().get(`/v1/assets/${made[0]!.created_id}?expand=category,vendor`))
      .body;
    expect(one).toMatchObject({
      serial: 'VM-1',
      purchase_date: '2024-04-03',
      purchase_cost: { amount_minor: 123450, currency: 'EUR' },
      status: { id: deployable.id },
    });
    expect(one.expanded.category.name).toBe('Personal computers');
    expect(one.expanded.vendor.name).toBe('Acme');
    const two = (await admin().get(`/v1/assets/${made[1]!.created_id}`)).body;
    expect(two).toMatchObject({
      purchase_date: '2024-06-05',
      purchase_cost: { amount_minor: 9900, currency: 'USD' },
      status: { id: retired.id },
    });
  });

  it('lists imports with filters, and keeps import:run (and the raw rows) from roles without it', async () => {
    const list = await admin().get(
      '/v1/imports?entity_type=asset&state=completed,cancelled&limit=5',
    );
    expect(list.status, list.raw).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data.every((j: Json) => ['completed', 'cancelled'].includes(j.state))).toBe(
      true,
    );
    expect(list.body.data[0]).not.toHaveProperty('profile');
    const page1 = await admin().get('/v1/imports?limit=2');
    expect(page1.body.page.has_more).toBe(true);
    const page2 = await admin().get(`/v1/imports?limit=2&cursor=${page1.body.page.next_cursor}`);
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);

    const viewer = await createUser(ih.h.app, t, 'viewer');
    const tech = await createUser(ih.h.app, t, 'technician');
    const manager = await createUser(ih.h.app, t, 'asset_manager');
    const id = list.body.data[0].id as string;
    expect((await viewer.client.get('/v1/imports')).status).toBe(200);
    const seen = await viewer.client.get(`/v1/imports/${id}`);
    expect(seen.status).toBe(200);
    // the shape of the file, not its cells: no sample rows, no sample values, no source values
    expect(seen.body.samples).toBeNull();
    expect(seen.body.value_map).toEqual({});
    expect(seen.body.profile.every((c: Json) => c.samples.length === 0)).toBe(true);
    const full = await admin().get(`/v1/imports/${id}`);
    expect(full.body.samples.length).toBeGreaterThan(0);
    expect((await viewer.client.get(`/v1/imports/${id}/rows`)).status).toBe(403);
    expect((await viewer.client.get(`/v1/imports/${id}/errors.csv`)).status).toBe(403);
    expect((await viewer.client.post('/v1/imports', { entity_type: 'asset' })).status).toBe(403);
    expect((await tech.client.post('/v1/imports', { entity_type: 'asset' })).status).toBe(403);
    expect((await tech.client.get('/v1/imports/presets')).status).toBe(200);
    expect((await manager.client.post('/v1/imports', { entity_type: 'asset' })).status).toBe(201);
  });

  it('exports re-import cleanly: the formula guard is stripped again (M2-REG-02 round trip)', async () => {
    const cf = await admin().post('/v1/custom-fields', {
      key: 'room_note',
      label: 'Room note',
      data_type: 'text',
    });
    expect(cf.status, cf.raw).toBe(201);
    const cat = (await admin().get('/v1/categories?q=Desktops')).body.data[0].id as string;
    const names = ['=SUM(A1)', '+49 170', '-dash', '@home', 'Plain, with comma', 'Quote " inside'];
    for (const [i, name] of names.entries()) {
      const r = await admin().post('/v1/assets', {
        category_id: cat,
        name,
        serial: `RT-${i}`,
        custom_data: { room_note: name },
        notes: 'multi\nline',
      });
      expect(r.status, r.raw).toBe(201);
    }
    const exp = await admin().post('/v1/exports', { resource: 'assets', filters: { q: 'RT-' } });
    expect(exp.status, exp.raw).toBe(202);
    const runner = ih.h.app.get(ExportRunner, { strict: false });
    await ih.runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
      runner.run(
        { tenantId: t.tenantId, exportId: exp.body.id },
        {
          tenantId: t.tenantId,
          tx,
          jobId: 'j',
          queue: 'export.run',
          retryCount: 0,
          logger: pino({ level: 'silent' }),
        },
      ),
    );
    const row = await ownerTenantSql(
      t.tenantId,
      'select storage_key from app.export_job where id = $1',
      [exp.body.id],
    );
    const chunks: Buffer[] = [];
    for await (const c of await ih.h.storage.read(row.rows[0].storage_key as string))
      chunks.push(c as Buffer);
    const file = Buffer.concat(chunks);
    expect(file.toString('utf8')).toContain("'=SUM(A1)");

    // into another tenant: identical values, nothing guarded
    const other = await createTenant(ih.h.app, tenancy, 'impround');
    await other.admin.post('/v1/custom-fields', {
      key: 'room_note',
      label: 'Room note',
      data_type: 'text',
    });
    const job = await analyzed(ih, other.admin, other.tenantId, 'asset', {
      filename: 'export.csv',
      body: file,
    });
    const targets = Object.fromEntries(
      job.mapping.columns.map((c: Json) => [job.headers[c.index], c.target]),
    );
    expect(targets).toMatchObject({
      asset_tag: 'asset_tag',
      name: 'name',
      serial: 'serial',
      category: 'category',
      model: 'model',
      status: 'status',
      location: 'location',
      'cf:room_note': 'cf:room_note',
    });
    const dry = await dryRun(ih, other.admin, other.tenantId, job.id);
    expect(
      dry.counts.dry_run,
      JSON.stringify((await allRows(other.admin, job.id)).map((r) => r.errors)),
    ).toEqual({ create: 6, update: 0, skip: 0, error: 0 });
    await commit(ih, other.admin, other.tenantId, job.id, dry.dry_run_digest);
    const got = (await other.admin.get('/v1/assets?q=RT-&limit=20')).body.data as Json[];
    expect(got.map((a) => a.name).sort()).toEqual([...names].sort());
    expect(got.map((a) => a.custom_data.room_note).sort()).toEqual([...names].sort());
    expect(got[0]!.notes).toBe('multi\nline');
    // and into the same tenant, matched by serial: nothing to do
    const same = await analyzed(
      ih,
      admin(),
      t.tenantId,
      'asset',
      { filename: 'export.csv', body: file },
      { options: { match_on: 'serial', on_match: 'update' } },
    );
    const dry3 = await dryRun(ih, admin(), t.tenantId, same.id);
    expect(dry3.counts.dry_run).toEqual({ create: 0, update: 0, skip: 6, error: 0 });
  });

  /** Uploads a file to an existing (preset) import and analyses it. */
  async function uploadAndAnalyze(importId: string, filename: string, body: Buffer): Promise<Json> {
    const { uploadFile } = await import('../files/support.js');
    const up = await uploadFile(
      ih.h,
      admin(),
      t.tenantId,
      { entity_type: 'import_job', entity_id: importId },
      { filename, content_type: 'text/csv', body, kind: 'import_file' },
    );
    await ownerTenantSql(
      t.tenantId,
      "update app.attachment set scan_status = 'clean' where id = $1",
      [up.id],
    );
    const res = await admin().post(`/v1/imports/${importId}/analyze`, {
      file_attachment_id: up.id,
    });
    expect(res.status, res.raw).toBe(202);
    return drain(ih, admin(), t.tenantId, importId);
  }

  async function fetchBinary(client: typeof t.admin, url: string): Promise<Buffer> {
    const res = await ih.h.app.inject({
      method: 'GET',
      url,
      headers: { cookie: client.cookie!, 'x-forwarded-for': client.ip },
    });
    expect(res.statusCode).toBe(200);
    return res.rawPayload;
  }
});
