import 'reflect-metadata';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import { stripFormulaGuard } from '../../src/exports/csv.js';
import { ExportRunner, MAX_PENDING_EXPORTS } from '../../src/exports/index.js';
import { JobHandlerRegistry, allQueues } from '../../src/jobs/index.js';
import { OutboxRelay, OutboxSubscribers } from '../../src/outbox/index.js';
import { TenancyService } from '../../src/tenancy/index.js';
import {
  type App,
  type Basics,
  type Client,
  type TenantFixture,
  auditRows,
  basics,
  contractViolations,
  createTenant,
  createUser,
  newAsset,
  newPerson,
  newTenancy,
  outboxRows,
  ownerTenantSql,
  startRegistryApp,
  testPorts,
  unique,
} from '../lifecycle/support.js';

/** The tiny CSV reader the importer will have: BOM, quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && src[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  return rows;
}

/** M2-REG-02: CSV export of lists through a worker job. */
describe.skipIf(!dbEnabled)(`exports (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;
  let b: Basics;
  let runtime: TenancyService;
  let runner: ExportRunner;
  let manager: { id: string; email: string; client: Client };
  const a = () => t.admin;
  const stored = (key: string) => testPorts.storage.objects.get(key)!;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'export');
    other = await createTenant(app, tenancy, 'export2');
    b = await basics(t);
    runtime = app.get(TenancyService, { strict: false });
    runner = app.get(ExportRunner, { strict: false });
    manager = await createUser(app, t, 'asset_manager');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  /** Runs the queued `export.run` job of an export, as the worker would. */
  async function runJob(exportId: string, retryCount = 0) {
    await runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
      runner.run(
        { tenantId: t.tenantId, exportId },
        {
          tenantId: t.tenantId,
          tx,
          jobId: 'job-1',
          queue: 'export.run',
          retryCount,
          logger: pino({ level: 'silent' }),
        },
      ),
    );
  }
  async function request(client: Client, body: Record<string, unknown>) {
    const res = await client.post('/v1/exports', body);
    expect(res.status, res.raw).toBe(202);
    return res.body as { id: string };
  }
  async function download(client: Client, id: string) {
    const res = await client.get(`/v1/exports/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('succeeded');
    const key = decodeURIComponent(new URL(res.body.download_url).pathname.replace('/get/', ''));
    return { meta: res.body, rows: parseCsv(stored(key).body.toString('utf8')), raw: stored(key) };
  }

  it('the worker has handlers for the export and notification queues, declared in the catalogue', () => {
    const registry = app.get(JobHandlerRegistry, { strict: false });
    for (const queue of ['export.run', 'export.sweep', 'notification.digest']) {
      expect(registry.has(queue), queue).toBe(true);
      expect(registry.get(queue)).toMatchObject({ tenantScoped: true, runsIn: 'worker' });
      expect(allQueues().map((q) => q.name)).toContain(queue);
    }
  });

  it('exports the filtered asset list: queued, run by the worker, downloaded through a short-lived link', async () => {
    const category = (
      await a().post('/v1/categories', { name: unique('ExpCat'), tag_prefix: 'EXP-' })
    ).body;
    const field = await a().post('/v1/custom-fields', {
      category_id: category.id,
      key: 'tier',
      label: 'Tier',
      data_type: 'text',
    });
    expect(field.status).toBe(201);
    const vendor = (await a().post('/v1/vendors', { name: unique('Vend') })).body;
    const mine = await newAsset(a(), category.id, {
      name: 'Laptop, 14"',
      serial: 'SN-1',
      vendor_id: vendor.id,
      purchase_cost: { amount_minor: 123456, currency: 'EUR' },
      purchase_date: '2026-01-05',
      notes: 'line one\nline two',
      custom_data: { tier: 'gold' },
    });
    const evil = await newAsset(a(), category.id, {
      name: '=HYPERLINK("http://evil","x")',
      custom_data: { tier: '@cmd' },
    });
    await newAsset(a(), b.categoryId, { name: 'Not in the category' });

    const created = await manager.client.post('/v1/exports', {
      resource: 'assets',
      filters: { category_id: [category.id], sort: 'asset_tag' },
    });
    expect(created.status).toBe(202);
    expect(created.headers.location).toBe(`/v1/exports/${created.body.id}`);
    expect(created.body).toMatchObject({
      resource: 'assets',
      format: 'csv',
      status: 'queued',
      download_url: null,
      row_count: null,
      requested_by: manager.id,
      filters: { category_id: category.id, sort: 'asset_tag' },
    });
    const jobs = testPorts.jobs.jobs.filter(
      (j) => j.name === 'export.run' && j.payload.exportId === created.body.id,
    );
    expect(jobs).toHaveLength(1);
    expect(Object.keys(jobs[0]!.payload).sort()).toEqual(['exportId', 'tenantId']); // ids only
    // nothing to download before the worker ran
    const pending = await manager.client.get(`/v1/exports/${created.body.id}`);
    expect(pending.body).toMatchObject({ status: 'queued', download_url: null });

    await runJob(created.body.id);
    const { meta, rows, raw } = await download(manager.client, created.body.id);
    expect(meta).toMatchObject({
      row_count: 2,
      filename: expect.stringMatching(/^assets-\d{4}-\d{2}-\d{2}\.csv$/),
    });
    expect(meta.size_bytes).toBe(raw.body.length);
    expect(meta.download_url).toMatch(
      /^https:\/\/storage\.fake\/get\/tenants\/[0-9a-f-]+\/\d{4}\/[0-9a-f-]+\.csv\?disposition=attachment$/,
    );
    expect(meta.download_url).toContain(`/tenants/${t.tenantId}/`);
    expect(raw.contentType).toBe('text/csv; charset=utf-8');
    expect(raw.body.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(raw.body.toString('utf8')).toContain('\r\n');

    const header = rows[0]!;
    expect(header.slice(0, 5)).toEqual(['asset_tag', 'name', 'serial', 'category', 'model']);
    expect(header.at(-1)).toBe('cf:tier');
    expect(rows).toHaveLength(3);
    const col = (r: string[], name: string) => r[header.indexOf(name)];
    // sorted by tag: the first asset created is the first row
    expect(col(rows[1]!, 'asset_tag')).toBe(mine.body.asset_tag);
    expect(col(rows[1]!, 'name')).toBe('Laptop, 14"');
    expect(col(rows[1]!, 'serial')).toBe('SN-1');
    expect(col(rows[1]!, 'category')).toBe(category.name);
    expect(col(rows[1]!, 'status')).toBe('Ready to deploy');
    expect(col(rows[1]!, 'vendor')).toBe(vendor.name);
    expect(col(rows[1]!, 'purchase_cost')).toBe('1234.56');
    expect(col(rows[1]!, 'currency')).toBe('EUR');
    expect(col(rows[1]!, 'purchase_date')).toBe('2026-01-05');
    expect(col(rows[1]!, 'notes')).toBe('line one\nline two');
    expect(col(rows[1]!, 'cf:tier')).toBe('gold');
    expect(col(rows[1]!, 'archived')).toBe('no');

    // CSV injection: the formula cells are neutralised and the importer's inverse restores them
    expect(col(rows[2]!, 'asset_tag')).toBe(evil.body.asset_tag);
    expect(col(rows[2]!, 'name')).toBe(`'=HYPERLINK("http://evil","x")`);
    expect(col(rows[2]!, 'cf:tier')).toBe("'@cmd");
    expect(stripFormulaGuard(col(rows[2]!, 'name')!)).toBe('=HYPERLINK("http://evil","x")');
    for (const r of rows.slice(1)) {
      for (const c of r) expect(c, `unguarded formula cell ${c}`).not.toMatch(/^[=+\-@\t\r]/);
    }

    // audited as a sensitive read: the request, the completion and every issued link (one here)
    const audit = await auditRows(t.tenantId, `entity_id = '${created.body.id}'`);
    expect(audit.map((r) => r.action)).toEqual([
      'export.requested',
      'export.completed',
      'export.downloaded',
    ]);
    expect(audit[0]!.diff?.meta).toMatchObject({ sensitive_read: true });
    expect(audit[2]!.diff?.meta).toMatchObject({
      sensitive_read: true,
      resource: 'assets',
      rows: 2,
    });
    const events = await outboxRows(t.tenantId, `aggregate_id = '${created.body.id}'`);
    expect(events.map((e) => e.event_type)).toEqual(['export.requested', 'export.completed']);

    // the requester is told in the bell
    await new OutboxRelay({
      tenancy: runtime,
      tenants: async () => [{ tenantId: t.tenantId }],
      subscribers: app.get(OutboxSubscribers, { strict: false }),
      logger: pino({ level: 'silent' }),
    }).runOnce();
    const bell = (await manager.client.get('/v1/notifications')).body.data;
    expect(bell).toEqual([
      expect.objectContaining({ type: 'export.completed', title: 'Your export is ready' }),
    ]);
    expect(bell[0].body).toContain(meta.filename);

    // a list never carries a link
    const list = await manager.client.get('/v1/exports');
    expect(list.body.data[0]).toMatchObject({
      id: created.body.id,
      status: 'succeeded',
      download_url: null,
    });
  });

  it('applies the list filters and writes people and locations too', async () => {
    const category = (await a().post('/v1/categories', { name: unique('Cat'), tag_prefix: 'FIL-' }))
      .body;
    await newAsset(a(), category.id, { name: 'Keep me' });
    await newAsset(a(), category.id, { name: 'Other thing' });
    const q = await request(manager.client, {
      resource: 'assets',
      filters: { category_id: category.id, q: 'keep' },
    });
    await runJob(q.id);
    expect((await download(manager.client, q.id)).rows).toHaveLength(2);

    const place = (await a().post('/v1/locations', { name: unique('HQ'), kind: 'site' })).body;
    const room = (
      await a().post('/v1/locations', {
        name: unique('Room'),
        parent_id: place.id,
        kind: 'room',
        code: '-R1',
      })
    ).body;
    const person = await newPerson(a(), {
      display_name: '+Ada Lovelace',
      email: `${unique('ada')}@export.example`,
      department: 'R&D',
      location_id: room.id,
    });
    const people = await request(manager.client, {
      resource: 'people',
      filters: { q: 'lovelace' },
    });
    await runJob(people.id);
    const p = await download(manager.client, people.id);
    expect(p.rows[0]!.slice(0, 3)).toEqual(['display_name', 'first_name', 'last_name']);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[1]![0]).toBe("'+Ada Lovelace");
    expect(p.rows[1]![p.rows[0]!.indexOf('location')]).toBe(room.name);
    expect(p.rows[1]![p.rows[0]!.indexOf('department')]).toBe('R&D');
    expect(person.id).toBeTruthy();

    const locations = await request(manager.client, {
      resource: 'locations',
      filters: { descendants_of: place.id },
    });
    await runJob(locations.id);
    const l = await download(manager.client, locations.id);
    const head = l.rows[0]!;
    const roomRow = l.rows.find((r) => r[0] === room.name)!;
    expect(roomRow[head.indexOf('path')]).toBe(`${place.name} / ${room.name}`);
    expect(roomRow[head.indexOf('parent')]).toBe(place.name);
    expect(roomRow[head.indexOf('code')]).toBe("'-R1");
  });

  it('validates the filters like the list endpoint, and who may export what', async () => {
    const bad = await manager.client.post('/v1/exports', {
      resource: 'assets',
      filters: { archived: 'maybe' },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].pointer).toBe('/filters');
    const paging = await manager.client.post('/v1/exports', {
      resource: 'assets',
      filters: { limit: 5, cursor: 'x' },
    });
    expect(paging.status).toBe(422);
    expect(paging.body.errors.map((e: { pointer: string }) => e.pointer).sort()).toEqual([
      '/filters/cursor',
      '/filters/limit',
    ]);
    const unknownField = await manager.client.post('/v1/exports', {
      resource: 'assets',
      filters: { 'cf[nope]': 'x' },
    });
    expect(unknownField.status).toBe(422);
    expect(
      (
        await manager.client.post('/v1/exports', {
          resource: 'people',
          filters: { status: 'ghost' },
        })
      ).status,
    ).toBe(422);
    expect((await manager.client.post('/v1/exports', { resource: 'accessories' })).status).toBe(
      422,
    );
    expect(
      (await manager.client.post('/v1/exports', { resource: 'assets', format: 'xlsx' })).status,
    ).toBe(422);

    // export:run belongs to administrators and asset managers
    const tech = await createUser(app, t, 'technician');
    const viewer = await createUser(app, t, 'viewer');
    expect((await tech.client.post('/v1/exports', { resource: 'assets' })).status).toBe(403);
    expect((await viewer.client.get('/v1/exports')).status).toBe(403);
    // ... and the read permission of the list is needed on top
    const key = await a().post('/v1/api-keys', {
      name: 'export',
      scopes: ['export:run', 'asset:read'],
    });
    const bearer = {
      headers: { authorization: `Bearer ${key.body.secret}` },
      cookie: false,
    } as const;
    expect((await a().clone().post('/v1/exports', { resource: 'assets' }, bearer)).status).toBe(
      202,
    );
    const noPeople = await a().clone().post('/v1/exports', { resource: 'people' }, bearer);
    expect(noPeople.status).toBe(403);
    expect(noPeople.body.detail).toMatch(/person:read/);
  });

  it('an export belongs to its requester: nobody else, not even an administrator or another tenant, can fetch it', async () => {
    const mine = await request(manager.client, { resource: 'locations' });
    await runJob(mine.id);
    expect((await a().get(`/v1/exports/${mine.id}`)).status).toBe(404);
    expect((await other.admin.get(`/v1/exports/${mine.id}`)).status).toBe(404);
    expect((await a().get('/v1/exports')).body.data.map((e: { id: string }) => e.id)).not.toContain(
      mine.id,
    );
    expect(
      (await manager.client.get('/v1/exports?status=succeeded')).body.data.map(
        (e: { id: string }) => e.id,
      ),
    ).toContain(mine.id);
    expect(
      (await manager.client.get('/v1/exports?status=failed')).body.data.map(
        (e: { id: string }) => e.id,
      ),
    ).not.toContain(mine.id);
    expect((await manager.client.get('/v1/exports/not-a-uuid')).status).toBe(400);
  });

  it('records a sentence when the filters stop being valid, writes no file and does not retry', async () => {
    const category = (await a().post('/v1/categories', { name: unique('Cat'), tag_prefix: 'GON-' }))
      .body;
    const field = (
      await a().post('/v1/custom-fields', {
        category_id: category.id,
        key: 'gone',
        label: 'Gone',
        data_type: 'text',
      })
    ).body;
    const exp = await request(manager.client, { resource: 'assets', filters: { 'cf[gone]': 'x' } });
    await ownerTenantSql(t.tenantId, `delete from app.custom_field_def where id = $1`, [field.id]);
    const objectsBefore = testPorts.storage.objects.size;
    await runJob(exp.id);
    const res = await manager.client.get(`/v1/exports/${exp.id}`);
    expect(res.body).toMatchObject({ status: 'failed', download_url: null, filename: null });
    expect(res.body.error).toMatch(/filters are not valid any more/);
    expect(testPorts.storage.objects.size).toBe(objectsBefore);
    expect((await auditRows(t.tenantId, `entity_id = '${exp.id}'`)).map((r) => r.action)).toEqual([
      'export.requested',
      'export.failed',
    ]);
    // running it again is a no-op
    await runJob(exp.id);
  });

  it('keeps at most five exports waiting per user', async () => {
    const user = await createUser(app, t, 'asset_manager');
    for (let i = 0; i < MAX_PENDING_EXPORTS; i++) {
      expect((await user.client.post('/v1/exports', { resource: 'locations' })).status).toBe(202);
    }
    const over = await user.client.post('/v1/exports', { resource: 'locations' });
    expect(over.status).toBe(409);
    expect(over.body.detail).toMatch(/waiting/);
  });

  it('deletes the file after its retention and reports the export as expired', async () => {
    const exp = await request(manager.client, { resource: 'locations' });
    await runJob(exp.id);
    const ready = await manager.client.get(`/v1/exports/${exp.id}`);
    const expiresAt = new Date(ready.body.expires_at).getTime();
    expect(expiresAt - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
    const key = (
      await ownerTenantSql(t.tenantId, `select storage_key from app.export_job where id = $1`, [
        exp.id,
      ])
    ).rows[0].storage_key as string;
    expect(testPorts.storage.objects.has(key)).toBe(true);

    // time passes
    await ownerTenantSql(
      t.tenantId,
      `update app.export_job set expires_at = now() - interval '1 minute' where id = $1`,
      [exp.id],
    );
    const lazily = await manager.client.get(`/v1/exports/${exp.id}`);
    expect(lazily.body).toMatchObject({ status: 'expired', download_url: null });
    await runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
      runner.sweep(
        { tenantId: t.tenantId },
        {
          tenantId: t.tenantId,
          tx,
          jobId: 'sweep',
          queue: 'export.sweep',
          retryCount: 0,
          logger: pino({ level: 'silent' }),
        },
      ),
    );
    expect(testPorts.storage.objects.has(key)).toBe(false);
    expect(
      (
        await ownerTenantSql(
          t.tenantId,
          `select status, storage_key from app.export_job where id = $1`,
          [exp.id],
        )
      ).rows[0],
    ).toEqual({ status: 'expired', storage_key: null });
  });
});
