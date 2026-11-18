import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, dbEnabled, env, withClient } from '../auth/support.js';
import { contractViolations } from '../support/contract-observer.js';
import {
  type App,
  type TenantFixture,
  type UserFixture,
  auditRows,
  createTenant,
  createUser,
  defaultStatusId,
  faults,
  insertAssets,
  newTenancy,
  outboxRows,
  ownerTenantSql,
  seedBasics,
  startRegistryApp,
  unique,
} from './support.js';

/** M1-REG-05..10: assets (create/read/update, tags, list, search, clone, bulk, archive/restore). */
describe.skipIf(!dbEnabled)('registry assets', () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;
  let viewer: UserFixture;
  let technician: UserFixture;
  let manager: UserFixture;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'assets');
    other = await createTenant(app, tenancy, 'assetsb');
    viewer = await createUser(app, t, 'viewer');
    technician = await createUser(app, t, 'technician');
    manager = await createUser(app, t, 'asset_manager');
  });
  afterAll(async () => {
    faults.outboxFailsFor = null;
    await app.close();
    await tenancy.onModuleDestroy();
    // every status this file provoked is one the contract documents for that operation
    expect(contractViolations()).toEqual([]);
  });

  const im = (res: { headers: Record<string, unknown> } | string) => ({
    headers: { 'if-match': typeof res === 'string' ? res : String(res.headers.etag) },
  });
  const a = () => t.admin;

  async function category(prefix = 'T-', body: Record<string, unknown> = {}) {
    const res = await a().post('/v1/categories', {
      name: unique('Cat'),
      tag_prefix: prefix,
      ...body,
    });
    expect(res.status, res.raw).toBe(201);
    return res.body as { id: string; name: string };
  }

  describe('create and read (REG-05)', () => {
    it('creates with defaults, an auto tag, ETag, Location, audit and outbox in the same transaction', async () => {
      const cat = await category('CR-');
      const res = await a().post('/v1/assets', {
        category_id: cat.id,
        name: 'Dana laptop',
        serial: 'C02XK1',
        purchase_cost: { amount_minor: 129900, currency: 'USD' },
        purchase_date: '2025-03-04',
        warranty_end: '2028-03-04',
        order_number: 'PO-1',
        notes: 'n',
      });
      expect(res.status, res.raw).toBe(201);
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(`/v1/assets/${res.body.id}`);
      expect(res.body).toMatchObject({
        asset_tag: 'CR-00001',
        name: 'Dana laptop',
        serial: 'C02XK1',
        category_id: cat.id,
        model_id: null,
        location_id: null,
        vendor_id: null,
        purchase_date: '2025-03-04',
        warranty_end: '2028-03-04',
        purchase_cost: { amount_minor: 129900, currency: 'USD' },
        custom_data: {},
        current_assignment: null,
        archived_at: null,
        status: { name: 'Ready to deploy', state_type: 'deployable' },
      });
      expect(res.body.label_code).toMatch(/^[0-9a-f]{32}$/);
      expect(res.body.company_id).toBeTruthy();
      const got = await a().get(`/v1/assets/${res.body.id}`);
      expect(got.body).toEqual(res.body);
      expect(got.headers.etag).toBe('W/"1"');

      const audit = await auditRows(t.tenantId, `entity_id = '${res.body.id}'`);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'asset.created',
        entity_type: 'asset',
        actor_type: 'user',
      });
      expect(audit[0]!.diff!.after).toMatchObject({ asset_tag: 'CR-00001', name: 'Dana laptop' });
      const events = await outboxRows(t.tenantId, `aggregate_id = '${res.body.id}'`);
      expect(events).toEqual([
        {
          event_type: 'asset.created',
          aggregate_type: 'asset',
          aggregate_id: res.body.id,
          payload: { version: 1, categoryId: cat.id, statusId: res.body.status_id },
        },
      ]);
    });

    it('lists field-level problems, including custom fields and references', async () => {
      const cat = await category();
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'ram_gb',
        label: 'RAM',
        data_type: 'number',
        validation: { min: 1 },
        required: true,
      });
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'os',
        label: 'OS',
        data_type: 'select',
        options: [{ value: 'macOS' }],
      });
      const res = await a().post('/v1/assets', {
        category_id: cat.id,
        status_id: crypto.randomUUID(),
        vendor_id: crypto.randomUUID(),
        model_id: crypto.randomUUID(),
        location_id: crypto.randomUUID(),
        custom_data: { os: 'BeOS', colour: 'red' },
        external_source: 'snipe_it',
      });
      expect(res.status).toBe(422);
      const pointers = res.body.errors.map((e: { pointer: string }) => e.pointer).sort();
      expect(pointers).toEqual(
        [
          '/custom_data/colour',
          '/custom_data/os',
          '/custom_data/ram_gb',
          '/external_id',
          '/location_id',
          '/model_id',
          '/status_id',
          '/vendor_id',
        ].sort(),
      );
      const codes = Object.fromEntries(
        res.body.errors.map((e: { pointer: string; code: string }) => [e.pointer, e.code]),
      );
      expect(codes['/custom_data/ram_gb']).toBe('required');
      expect(codes['/custom_data/os']).toBe('invalid_option');
      expect(codes['/custom_data/colour']).toBe('unknown-field');
      // nothing was written
      expect((await a().get(`/v1/assets?category_id=${cat.id}`)).body.data).toEqual([]);
      expect((await a().post('/v1/assets', {})).status).toBe(422);
      expect(
        (
          await a().post('/v1/assets', {
            category_id: cat.id,
            unknown: 1,
            custom_data: { ram_gb: 8 },
          })
        ).body.errors[0].pointer,
      ).toBe('/');
    });

    it('coerces custom values and stores canonical JSON; a model must belong to the asset category', async () => {
      const { category: cat, model } = await seedBasics(a());
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'ram_gb',
        label: 'RAM',
        data_type: 'number',
      });
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'enc',
        label: 'Enc',
        data_type: 'boolean',
      });
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'tags',
        label: 'Tags',
        data_type: 'multiselect',
        options: [{ value: 'a' }, { value: 'b' }],
      });
      const ok = await a().post('/v1/assets', {
        category_id: cat.id,
        model_id: model.id,
        custom_data: { ram_gb: '16', enc: 'true', tags: ['a', 'a', 'b'] },
      });
      expect(ok.status, ok.raw).toBe(201);
      expect(ok.body.custom_data).toEqual({ ram_gb: 16, enc: true, tags: ['a', 'b'] });
      const other2 = await category();
      const mismatch = await a().post('/v1/assets', { category_id: other2.id, model_id: model.id });
      expect(mismatch.status).toBe(422);
      expect(mismatch.body.errors[0]).toMatchObject({ pointer: '/model_id', code: 'invalid' });
      expect(
        (await a().post('/v1/assets', { category_id: crypto.randomUUID() })).body.errors[0].pointer,
      ).toBe('/category_id');
    });

    it('a duplicate tag in the same tenant is 409 (case-insensitive); the same tag in another tenant is fine', async () => {
      const cat = await category();
      const tag = unique('DUP').toUpperCase();
      expect((await a().post('/v1/assets', { category_id: cat.id, asset_tag: tag })).status).toBe(
        201,
      );
      const dup = await a().post('/v1/assets', {
        category_id: cat.id,
        asset_tag: tag.toLowerCase(),
      });
      expect(dup.status).toBe(409);
      expect(dup.body).toMatchObject({ code: 'conflict' });
      expect(dup.body.errors[0]).toMatchObject({ pointer: '/asset_tag', code: 'duplicate' });
      const otherCat = await other.admin.post('/v1/categories', { name: unique('C') });
      expect(
        (await other.admin.post('/v1/assets', { category_id: otherCat.body.id, asset_tag: tag }))
          .status,
      ).toBe(201);
    });

    it("another tenant's ids are invalid references, never accepted", async () => {
      const cat = await category();
      const foreign = await seedBasics(other.admin);
      const res = await a().post('/v1/assets', {
        category_id: foreign.category.id,
        model_id: foreign.model.id,
      });
      expect(res.status).toBe(422);
      const res2 = await a().post('/v1/assets', {
        category_id: cat.id,
        vendor_id: (await other.admin.post('/v1/vendors', { name: unique('V') })).body.id,
      });
      expect(res2.status).toBe(422);
      expect(res2.body.errors[0].pointer).toBe('/vendor_id');
    });

    it('a failure after the audit/outbox write rolls back the asset, the audit row, the outbox row and the counter', async () => {
      const cat = await category('RB-');
      const before = await auditRows(t.tenantId);
      faults.outboxFailsFor = 'asset.created';
      let res;
      try {
        res = await a().post('/v1/assets', { category_id: cat.id, name: 'will not exist' });
      } finally {
        faults.outboxFailsFor = null;
      }
      expect(res.status).toBe(500);
      expect((await a().get(`/v1/assets?category_id=${cat.id}`)).body.data).toEqual([]);
      expect((await auditRows(t.tenantId)).length).toBe(before.length);
      // the counter rolled back too: the first successful create is still number 1
      const ok = await a().post('/v1/assets', { category_id: cat.id });
      expect(ok.body.asset_tag).toBe('RB-00001');
    });

    it('permissions: viewer reads only, technician updates but neither creates nor archives, manager does it all', async () => {
      const cat = await category();
      const created = await manager.client.post('/v1/assets', { category_id: cat.id });
      expect(created.status).toBe(201);
      const id = created.body.id;
      expect((await viewer.client.get(`/v1/assets/${id}`)).status).toBe(200);
      expect((await viewer.client.post('/v1/assets', { category_id: cat.id })).status).toBe(403);
      expect(
        (await viewer.client.patch(`/v1/assets/${id}`, { name: 'x' }, im(created))).status,
      ).toBe(403);
      expect((await technician.client.post('/v1/assets', { category_id: cat.id })).status).toBe(
        403,
      );
      const upd = await technician.client.patch(
        `/v1/assets/${id}`,
        { name: 'by tech' },
        im(created),
      );
      expect(upd.status, upd.raw).toBe(200);
      expect((await technician.client.del(`/v1/assets/${id}`, undefined, im(upd))).status).toBe(
        403,
      );
      expect((await manager.client.del(`/v1/assets/${id}`, undefined, im(upd))).status).toBe(204);
    });
  });

  describe('update (ETag / If-Match)', () => {
    it('merges fields, bumps the ETag, audits the diff and emits asset.updated', async () => {
      const cat = await category('UP-');
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'ram_gb',
        label: 'RAM',
        data_type: 'number',
      });
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'note',
        label: 'Note',
        data_type: 'text',
      });
      const created = await a().post('/v1/assets', {
        category_id: cat.id,
        name: 'old',
        serial: 'S1',
        custom_data: { ram_gb: 8, note: 'x' },
      });
      const status = (await a().get('/v1/status-labels')).body.data.find(
        (s: { name: string }) => s.name === 'Deployed',
      );
      const res = await a().patch(
        `/v1/assets/${created.body.id}`,
        {
          name: 'new',
          serial: null,
          status_id: status.id,
          custom_data: { ram_gb: 16, note: null },
        },
        im(created),
      );
      expect(res.status, res.raw).toBe(200);
      expect(res.headers.etag).toBe('W/"2"');
      expect(res.body).toMatchObject({
        name: 'new',
        serial: null,
        status: { name: 'Deployed', state_type: 'deployed' },
        custom_data: { ram_gb: 16 },
        asset_tag: created.body.asset_tag,
      });
      expect(res.body.custom_data).not.toHaveProperty('note');
      const audit = await auditRows(
        t.tenantId,
        `entity_id = '${created.body.id}' and action = 'asset.updated'`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.diff!.before).toMatchObject({
        name: 'old',
        serial: 'S1',
        custom_data: { ram_gb: 8, note: 'x' },
      });
      expect(audit[0]!.diff!.after).toMatchObject({
        name: 'new',
        serial: null,
        status_id: status.id,
      });
      const events = await outboxRows(
        t.tenantId,
        `aggregate_id = '${created.body.id}' and event_type = 'asset.updated'`,
      );
      expect(events[0]!.payload).toMatchObject({ version: 2, statusId: status.id });
    });

    it('requires If-Match (428), refuses a stale one (412), and a no-op patch changes nothing', async () => {
      const cat = await category();
      const created = await a().post('/v1/assets', { category_id: cat.id, name: 'n' });
      expect((await a().patch(`/v1/assets/${created.body.id}`, { name: 'x' })).status).toBe(428);
      const first = await a().patch(`/v1/assets/${created.body.id}`, { name: 'x' }, im(created));
      expect(first.status).toBe(200);
      const stale = await a().patch(`/v1/assets/${created.body.id}`, { name: 'y' }, im(created));
      expect(stale.status).toBe(412);
      expect(stale.body.code).toBe('precondition-failed');
      expect(stale.body.detail).toContain('W/"2"');
      const noop = await a().patch(`/v1/assets/${created.body.id}`, { name: 'x' }, im(first));
      expect(noop.status).toBe(200);
      expect(noop.headers.etag).toBe(first.headers.etag);
      const audit = await auditRows(t.tenantId, `entity_id = '${created.body.id}'`);
      expect(audit.map((r) => r.action)).toEqual(['asset.created', 'asset.updated']);
      // If-Match: * matches anything; a malformed value is a 400
      expect(
        (await a().patch(`/v1/assets/${created.body.id}`, { name: 'z' }, im('*'))).status,
      ).toBe(200);
      expect(
        (await a().patch(`/v1/assets/${created.body.id}`, { name: 'z' }, im('garbage'))).status,
      ).toBe(400);
    });

    it('two writers racing on one ETag: exactly one wins, the other gets 412', async () => {
      const cat = await category();
      const created = await a().post('/v1/assets', { category_id: cat.id });
      const results = await Promise.all(
        ['a', 'b', 'c', 'd'].map((n) =>
          a().clone().patch(`/v1/assets/${created.body.id}`, { name: n }, im(created)),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 412)).toHaveLength(3);
    });

    it('the tag never changes (ED-12); company and category rules are enforced; archived assets are read-only', async () => {
      const cat = await category();
      const created = await a().post('/v1/assets', { category_id: cat.id });
      const retag = await a().patch(
        `/v1/assets/${created.body.id}`,
        { asset_tag: 'NEW-TAG' },
        im(created),
      );
      expect(retag.status).toBe(422);
      expect(retag.body.errors[0]).toMatchObject({ pointer: '/asset_tag', code: 'immutable' });
      const same = await a().patch(
        `/v1/assets/${created.body.id}`,
        { asset_tag: created.body.asset_tag.toLowerCase() },
        im(created),
      );
      expect(same.status).toBe(200);
      const noCompany = await a().patch(
        `/v1/assets/${created.body.id}`,
        { company_id: crypto.randomUUID() },
        im(created),
      );
      expect(noCompany.status).toBe(422);
      const loc = await a().patch(
        `/v1/assets/${created.body.id}`,
        { location_id: crypto.randomUUID() },
        im(created),
      );
      expect(loc.body.errors[0]).toMatchObject({ pointer: '/location_id', code: 'not-supported' });
      const archived = await a().del(`/v1/assets/${created.body.id}`, undefined, im(created));
      expect(archived.status).toBe(204);
      const g = await a().get(`/v1/assets/${created.body.id}`);
      const blocked = await a().patch(`/v1/assets/${created.body.id}`, { name: 'x' }, im(g));
      expect(blocked.status).toBe(409);
    });

    it('moving an asset to another category re-validates its custom data', async () => {
      const c1 = await category();
      const c2 = await category();
      await a().post('/v1/custom-fields', {
        category_id: c1.id,
        key: 'only_c1',
        label: 'x',
        data_type: 'text',
      });
      await a().post('/v1/custom-fields', {
        category_id: c2.id,
        key: 'must_c2',
        label: 'y',
        data_type: 'text',
        required: true,
      });
      const created = await a().post('/v1/assets', {
        category_id: c1.id,
        custom_data: { only_c1: 'v' },
      });
      const move = await a().patch(
        `/v1/assets/${created.body.id}`,
        { category_id: c2.id },
        im(created),
      );
      expect(move.status).toBe(422);
      expect(move.body.errors.map((e: { pointer: string }) => e.pointer).sort()).toEqual([
        '/custom_data/must_c2',
        '/custom_data/only_c1',
      ]);
      const ok = await a().patch(
        `/v1/assets/${created.body.id}`,
        { category_id: c2.id, custom_data: { only_c1: null, must_c2: 'z' } },
        im(created),
      );
      expect(ok.status, ok.raw).toBe(200);
      expect(ok.body).toMatchObject({ category_id: c2.id, custom_data: { must_c2: 'z' } });
    });

    it('parent assets: no self parent, no cycles, must exist', async () => {
      const cat = await category();
      const p = await a().post('/v1/assets', { category_id: cat.id });
      const c = await a().post('/v1/assets', { category_id: cat.id, parent_asset_id: p.body.id });
      expect(c.status, c.raw).toBe(201);
      expect(
        (await a().patch(`/v1/assets/${p.body.id}`, { parent_asset_id: p.body.id }, im(p))).status,
      ).toBe(422);
      const cyc = await a().patch(`/v1/assets/${p.body.id}`, { parent_asset_id: c.body.id }, im(p));
      expect(cyc.status).toBe(422);
      expect(cyc.body.errors[0].message).toMatch(/cycle/);
      expect(
        (
          await a().post('/v1/assets', {
            category_id: cat.id,
            parent_asset_id: crypto.randomUUID(),
          })
        ).status,
      ).toBe(422);
    });
  });

  describe('Idempotency-Key (PLAT-02 on assets)', () => {
    it('replays the stored response for the same key and body, 422 for a different body', async () => {
      const cat = await category();
      const key = unique('idem-key');
      const body = { category_id: cat.id, name: 'once' };
      const first = await a().post('/v1/assets', body, { headers: { 'idempotency-key': key } });
      expect(first.status).toBe(201);
      const replay = await a().post('/v1/assets', body, { headers: { 'idempotency-key': key } });
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(replay.headers.etag).toBe(first.headers.etag);
      expect((await a().get(`/v1/assets?category_id=${cat.id}`)).body.data).toHaveLength(1);
      const reuse = await a().post(
        '/v1/assets',
        { ...body, name: 'different' },
        { headers: { 'idempotency-key': key } },
      );
      expect(reuse.status).toBe(422);
      expect(reuse.body.code).toBe('idempotency-key-reuse');
    });

    it('concurrent duplicates create exactly one asset', async () => {
      const cat = await category();
      const key = unique('idem-race');
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          a()
            .clone()
            .post(
              '/v1/assets',
              { category_id: cat.id, name: 'race' },
              { headers: { 'idempotency-key': key } },
            ),
        ),
      );
      for (const r of results) expect([201, 409]).toContain(r.status);
      expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
      expect((await a().get(`/v1/assets?category_id=${cat.id}`)).body.data).toHaveLength(1);
      expect(new Set(results.filter((r) => r.status === 201).map((r) => r.body.id)).size).toBe(1);
    });

    it('a PATCH replays too, without a second version bump', async () => {
      const cat = await category();
      const created = await a().post('/v1/assets', { category_id: cat.id });
      const key = unique('idem-patch');
      const one = await a().patch(
        `/v1/assets/${created.body.id}`,
        { name: 'p' },
        { headers: { 'idempotency-key': key, ...im(created).headers } },
      );
      const two = await a().patch(
        `/v1/assets/${created.body.id}`,
        { name: 'p' },
        { headers: { 'idempotency-key': key, ...im(created).headers } },
      );
      expect(one.status).toBe(200);
      expect(two.status).toBe(200);
      expect(two.headers['idempotent-replayed']).toBe('true');
      expect((await a().get(`/v1/assets/${created.body.id}`)).headers.etag).toBe('W/"2"');
    });
  });

  describe('tag numbering (REG-06, ED-12)', () => {
    it('100 parallel creates in one tenant produce 100 distinct tags; two tenants allocate independently', async () => {
      const cat = await category('PAR-');
      const otherCat = await other.admin.post('/v1/categories', {
        name: unique('C'),
        tag_prefix: 'PAR-',
      });
      const results = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          a()
            .clone()
            .post('/v1/assets', { category_id: cat.id, name: `p${i}` }),
        ),
      );
      expect(
        results.every((r) => r.status === 201),
        JSON.stringify(results.find((r) => r.status !== 201)?.body),
      ).toBe(true);
      const tags = results.map((r) => r.body.asset_tag as string);
      expect(new Set(tags).size).toBe(100);
      expect(tags.every((x) => /^PAR-\d{5}$/.test(x))).toBe(true);
      expect(Math.max(...tags.map((x) => Number(x.slice(4))))).toBe(100);
      const first = await other.admin.post('/v1/assets', { category_id: otherCat.body.id });
      expect(first.body.asset_tag).toBe('PAR-00001');
    });

    it('a manual tag overrides the template and does not consume a number; a generated tag skips a taken one', async () => {
      const cat = await category('MAN-');
      const manual = await a().post('/v1/assets', { category_id: cat.id, asset_tag: 'MAN-00002' });
      expect(manual.body.asset_tag).toBe('MAN-00002');
      const g1 = await a().post('/v1/assets', { category_id: cat.id });
      expect(g1.body.asset_tag).toBe('MAN-00001');
      const g2 = await a().post('/v1/assets', { category_id: cat.id });
      expect(g2.body.asset_tag).toBe('MAN-00003'); // 00002 is taken by the manual tag
    });

    it('a template change applies to new tags only; the counter is per full prefix', async () => {
      const cat = await category('TPL-');
      const before = await a().post('/v1/assets', { category_id: cat.id });
      const tpl = await a().get('/v1/settings/asset-tag-template');
      const put = await a().request('PUT', '/v1/settings/asset-tag-template', {
        body: { prefix: 'ZZ-', width: 3, use_category_prefix: true },
        ...im(tpl),
      });
      expect(put.status, put.raw).toBe(200);
      try {
        const after = await a().post('/v1/assets', { category_id: cat.id });
        expect(after.body.asset_tag).toBe('ZZ-TPL-001');
        expect((await a().get(`/v1/assets/${before.body.id}`)).body.asset_tag).toBe(
          before.body.asset_tag,
        );
        const noCat = await a().request('PUT', '/v1/settings/asset-tag-template', {
          body: { prefix: 'ID', width: 4, use_category_prefix: false },
          ...im(put),
        });
        const third = await a().post('/v1/assets', { category_id: cat.id });
        expect(third.body.asset_tag).toBe('ID0001');
        expect(noCat.status).toBe(200);
      } finally {
        const cur = await a().get('/v1/settings/asset-tag-template');
        await a().request('PUT', '/v1/settings/asset-tag-template', {
          body: { prefix: '', width: 5, use_category_prefix: true },
          ...im(cur),
        });
      }
    });

    it('tags are never reused: an archived asset keeps its tag, even for a manual create', async () => {
      const cat = await category('NR-');
      const first = await a().post('/v1/assets', { category_id: cat.id });
      await a().del(`/v1/assets/${first.body.id}`, undefined, im(first));
      const reuse = await a().post('/v1/assets', {
        category_id: cat.id,
        asset_tag: first.body.asset_tag,
      });
      expect(reuse.status).toBe(409);
      const next = await a().post('/v1/assets', { category_id: cat.id });
      expect(next.body.asset_tag).toBe('NR-00002');
    });
  });

  describe('archive and restore (REG-10)', () => {
    it('archived assets are hidden by default, filterable, restorable, audited and not counted as active', async () => {
      const cat = await category('AR-');
      const x = await a().post('/v1/assets', { category_id: cat.id, name: 'x' });
      const y = await a().post('/v1/assets', { category_id: cat.id, name: 'y' });
      const del = await a().del(`/v1/assets/${x.body.id}`, undefined, im(x));
      expect(del.status).toBe(204);
      const active = await a().get(`/v1/assets?category_id=${cat.id}&include_total=true`);
      expect(active.body.data.map((r: { id: string }) => r.id)).toEqual([y.body.id]);
      expect(active.body.page.total).toBe(1);
      const only = await a().get(`/v1/assets?category_id=${cat.id}&archived=only`);
      expect(only.body.data.map((r: { id: string }) => r.id)).toEqual([x.body.id]);
      expect(
        (await a().get(`/v1/assets?category_id=${cat.id}&archived=include&include_total=true`)).body
          .page.total,
      ).toBe(2);
      const got = await a().get(`/v1/assets/${x.body.id}`);
      expect(got.body.archived_at).not.toBeNull();
      expect((await a().del(`/v1/assets/${x.body.id}`, undefined, im(got))).status).toBe(409);

      expect((await a().post(`/v1/assets/${x.body.id}/restore`, undefined, {})).status).toBe(428);
      const restored = await a().post(`/v1/assets/${x.body.id}/restore`, undefined, im(got));
      expect(restored.status, restored.raw).toBe(200);
      expect(restored.body.archived_at).toBeNull();
      expect(restored.headers.etag).toBeTruthy();
      expect(
        (await a().post(`/v1/assets/${x.body.id}/restore`, undefined, im(restored))).status,
      ).toBe(409);
      expect(
        (await a().get(`/v1/assets?category_id=${cat.id}&include_total=true`)).body.page.total,
      ).toBe(2);

      const audit = await auditRows(t.tenantId, `entity_id = '${x.body.id}'`);
      expect(audit.map((r) => r.action)).toEqual([
        'asset.created',
        'asset.archived',
        'asset.restored',
      ]);
      const events = await outboxRows(t.tenantId, `aggregate_id = '${x.body.id}'`);
      expect(events.map((e) => e.event_type)).toEqual([
        'asset.created',
        'asset.archived',
        'asset.restored',
      ]);
    });

    it('there is no hard delete: the runtime role cannot DELETE from app.asset', async () => {
      await expect(
        withClient(env.databaseUrl!, async (c) => {
          await c.query('begin');
          try {
            await c.query(`select set_config('app.tenant_id', $1, true)`, [t.tenantId]);
            await c.query('delete from app.asset');
          } finally {
            await c.query('rollback');
          }
        }),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('clone (REG-09)', () => {
    it('creates N copies with fresh tags and cleared serials, copying the chosen fields', async () => {
      const { category: cat, model } = await seedBasics(a());
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'ram_gb',
        label: 'RAM',
        data_type: 'number',
      });
      const vendor = await a().post('/v1/vendors', { name: unique('V') });
      const src = await a().post('/v1/assets', {
        category_id: cat.id,
        model_id: model.id,
        vendor_id: vendor.body.id,
        name: 'Source',
        serial: 'SRC-1',
        notes: 'keep',
        order_number: 'PO-7',
        purchase_cost: { amount_minor: 5000, currency: 'EUR' },
        custom_data: { ram_gb: 32 },
        external_source: 'x',
        external_id: '1',
      });
      expect(src.status, src.raw).toBe(201);
      const res = await a().post(`/v1/assets/${src.body.id}/clone`, { count: 3 });
      expect(res.status, res.raw).toBe(201);
      expect(res.body.data).toHaveLength(3);
      const tags = res.body.data.map((c: { asset_tag: string }) => c.asset_tag);
      expect(new Set([...tags, src.body.asset_tag]).size).toBe(4);
      for (const c of res.body.data) {
        expect(c).toMatchObject({
          name: 'Source',
          serial: null,
          model_id: model.id,
          vendor_id: vendor.body.id,
          notes: 'keep',
          order_number: 'PO-7',
          purchase_cost: { amount_minor: 5000, currency: 'EUR' },
          custom_data: { ram_gb: 32 },
          external_source: null,
          external_id: null,
        });
        expect(c.label_code).not.toBe(src.body.label_code);
      }
      const partial = await a().post(`/v1/assets/${src.body.id}/clone`, {
        count: 1,
        copy_fields: ['model_id'],
      });
      expect(partial.body.data[0]).toMatchObject({
        name: null,
        model_id: model.id,
        vendor_id: null,
        notes: null,
        custom_data: {},
      });
      const explicit = await a().post(`/v1/assets/${src.body.id}/clone`, {
        count: 2,
        asset_tags: [unique('CL').toUpperCase(), unique('CL').toUpperCase()],
        copy_fields: [],
      });
      expect(explicit.status, explicit.raw).toBe(201);
      const audit = await auditRows(
        t.tenantId,
        `action = 'asset.cloned' and entity_id = '${src.body.id}'`,
      );
      expect(audit).toHaveLength(3);
      expect(
        (await auditRows(t.tenantId, `action = 'asset.created'`)).filter(
          (r) => r.diff?.meta?.cloned_from === src.body.id,
        ),
      ).toHaveLength(6);
    });

    it('is all or nothing: a taken explicit tag fails the request and creates nothing', async () => {
      const cat = await category();
      const src = await a().post('/v1/assets', {
        category_id: cat.id,
        asset_tag: unique('SRC').toUpperCase(),
      });
      const res = await a().post(`/v1/assets/${src.body.id}/clone`, {
        count: 2,
        asset_tags: [unique('FREE').toUpperCase(), src.body.asset_tag],
      });
      expect(res.status).toBe(409);
      expect(res.body.errors[0].pointer).toBe('/asset_tags/1');
      expect((await a().get(`/v1/assets?category_id=${cat.id}`)).body.data).toHaveLength(1);
      expect(
        (await a().post(`/v1/assets/${src.body.id}/clone`, { count: 2, asset_tags: ['ONE'] }))
          .status,
      ).toBe(422);
      expect((await a().post(`/v1/assets/${crypto.randomUUID()}/clone`, {})).status).toBe(404);
      expect((await viewer.client.post(`/v1/assets/${src.body.id}/clone`, {})).status).toBe(403);
    });
  });

  describe('bulk operations (REG-09)', () => {
    it('edits many assets with per-item results; a failure does not roll back the others', async () => {
      const cat = await category('BK-');
      const mk = async () => (await a().post('/v1/assets', { category_id: cat.id })).body;
      const [x, y, z] = [await mk(), await mk(), await mk()];
      const archived = await mk();
      await a().del(`/v1/assets/${archived.id}`, undefined, { headers: { 'if-match': '*' } });
      const foreign = (
        await other.admin.post('/v1/assets', {
          category_id: (await other.admin.post('/v1/categories', { name: unique('C') })).body.id,
        })
      ).body;
      const status = (await a().get('/v1/status-labels')).body.data.find(
        (s: { name: string }) => s.name === 'Deployed',
      );
      const ids = [x.id, crypto.randomUUID(), y.id, archived.id, foreign.id, z.id];
      const res = await a().post('/v1/assets/bulk-update', {
        ids,
        changes: { status_id: status.id },
      });
      expect(res.status, res.raw).toBe(200);
      expect(res.body.summary).toEqual({ total: 6, succeeded: 3, failed: 3 });
      expect(res.body.results.map((r: { status: number }) => r.status)).toEqual([
        200, 404, 200, 409, 404, 200,
      ]);
      expect(res.body.results[0].data.status.id).toBe(status.id);
      expect(res.body.results[1].error).toMatchObject({ code: 'not-found', status: 404 });
      expect(res.body.results.map((r: { index: number }) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
      for (const id of [x.id, y.id, z.id])
        expect((await a().get(`/v1/assets/${id}`)).body.status.id).toBe(status.id);
      // the foreign tenant's asset is untouched
      expect((await other.admin.get(`/v1/assets/${foreign.id}`)).body.status.name).toBe(
        'Ready to deploy',
      );

      // one audit entry per changed asset plus the parent bulk-operation record
      const parent = (await auditRows(t.tenantId, `action = 'asset.bulk_update'`)).at(-1)!;
      expect(parent).toMatchObject({ entity_type: 'bulk_operation' });
      expect(parent.diff!.meta).toMatchObject({
        operation: 'update',
        requested: 6,
        succeeded: 3,
        failed: 3,
      });
      const children = (await auditRows(t.tenantId, `action = 'asset.updated'`)).filter(
        (r) => r.diff?.meta?.bulk_operation_id === parent.entity_id,
      );
      expect(children.map((c) => c.entity_id).sort()).toEqual([x.id, y.id, z.id].sort());
      const ev = await outboxRows(
        t.tenantId,
        `event_type = 'bulk_operation.completed' and aggregate_id = '${parent.entity_id}'`,
      );
      expect(ev[0]!.payload).toMatchObject({ operation: 'update', total: 6, failed: 3 });
    });

    it('validates changes per item: category, model, custom fields', async () => {
      const c1 = await category();
      const c2 = await category();
      await a().post('/v1/custom-fields', {
        category_id: c1.id,
        key: 'k',
        label: 'k',
        data_type: 'number',
      });
      const i1 = (await a().post('/v1/assets', { category_id: c1.id })).body;
      const i2 = (await a().post('/v1/assets', { category_id: c1.id })).body;
      const res = await a().post('/v1/assets/bulk-update', {
        ids: [i1.id, i2.id],
        changes: { custom_data: { k: '5', nope: 1 } },
      });
      expect(res.body.summary.failed).toBe(2);
      expect(res.body.results[0].error.code).toBe('validation');
      expect(res.body.results[0].error.errors[0].pointer).toBe('/custom_data/nope');
      const ok = await a().post('/v1/assets/bulk-update', {
        ids: [i1.id, i2.id],
        changes: { custom_data: { k: '5' } },
      });
      expect(ok.body.summary).toEqual({ total: 2, succeeded: 2, failed: 0 });
      expect((await a().get(`/v1/assets/${i1.id}`)).body.custom_data).toEqual({ k: 5 });
      const move = await a().post('/v1/assets/bulk-update', {
        ids: [i1.id],
        changes: { category_id: c2.id },
      });
      expect(move.body.results[0].status).toBe(422);
    });

    it('archives and restores in bulk; limits and permissions', async () => {
      const cat = await category();
      const ids = [
        (await a().post('/v1/assets', { category_id: cat.id })).body.id,
        (await a().post('/v1/assets', { category_id: cat.id })).body.id,
      ];
      const arch = await a().post('/v1/assets/bulk-archive', { ids: [...ids, ids[0]] });
      expect(arch.body.summary).toEqual({ total: 2, succeeded: 2, failed: 0 }); // duplicates collapse
      expect((await a().get(`/v1/assets?category_id=${cat.id}`)).body.data).toHaveLength(0);
      const again = await a().post('/v1/assets/bulk-archive', { ids });
      expect(again.body.results.map((r: { status: number }) => r.status)).toEqual([409, 409]);
      const back = await a().post('/v1/assets/bulk-restore', { ids });
      expect(back.body.summary.succeeded).toBe(2);
      expect((await a().get(`/v1/assets?category_id=${cat.id}`)).body.data).toHaveLength(2);

      const many = await a().post('/v1/assets/bulk-archive', {
        ids: Array.from({ length: 101 }, () => crypto.randomUUID()),
      });
      expect(many.status).toBe(422);
      expect((await a().post('/v1/assets/bulk-update', { ids, changes: {} })).status).toBe(422);
      expect((await technician.client.post('/v1/assets/bulk-archive', { ids })).status).toBe(403);
      expect(
        (
          await technician.client.post('/v1/assets/bulk-update', {
            ids,
            changes: { vendor_id: null },
          })
        ).status,
      ).toBe(200);
      expect(
        (await viewer.client.post('/v1/assets/bulk-update', { ids, changes: { vendor_id: null } }))
          .status,
      ).toBe(403);
    });

    it('is idempotent with an Idempotency-Key', async () => {
      const cat = await category();
      const ids = [(await a().post('/v1/assets', { category_id: cat.id })).body.id];
      const key = unique('bulk-key');
      const one = await a().post(
        '/v1/assets/bulk-archive',
        { ids },
        { headers: { 'idempotency-key': key } },
      );
      const two = await a().post(
        '/v1/assets/bulk-archive',
        { ids },
        { headers: { 'idempotency-key': key } },
      );
      expect(one.body.summary.succeeded).toBe(1);
      expect(two.headers['idempotent-replayed']).toBe('true');
      expect(two.body).toEqual(one.body);
      expect(
        await auditRows(t.tenantId, `action = 'asset.archived' and entity_id = '${ids[0]}'`),
      ).toHaveLength(1);
    });
  });

  describe('list, filters, sort, pagination (REG-07)', () => {
    let cat: { id: string };
    let model: { id: string };
    let manufacturer: { id: string };
    let vendor: { id: string };
    let statusId: string;
    let deployedId: string;
    const N = 53;

    beforeAll(async () => {
      const b = await seedBasics(a());
      cat = b.category;
      model = b.model;
      manufacturer = b.manufacturer;
      vendor = (await a().post('/v1/vendors', { name: unique('LV') })).body;
      statusId = await defaultStatusId(a());
      deployedId = (await a().get('/v1/status-labels')).body.data.find(
        (s: { name: string }) => s.name === 'Deployed',
      ).id;
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'tier',
        label: 'Tier',
        data_type: 'select',
        options: [{ value: 'gold' }, { value: 'silver' }],
      });
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'n',
        label: 'n',
        data_type: 'number',
      });
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'even',
        label: 'even',
        data_type: 'boolean',
      });
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'flags',
        label: 'flags',
        data_type: 'multiselect',
        options: [{ value: 'x' }, { value: 'y' }],
      });
      // N rows with IDENTICAL created_at (worst case for the cursor) and N rows spread over time
      await insertAssets(t.tenantId, cat.id, statusId, N, {
        tagPrefix: 'LST-',
        modelId: model.id,
        vendorId: vendor.id,
      });
      await insertAssets(t.tenantId, cat.id, deployedId, N, { tagPrefix: 'SPR-', spread: true });
    });

    const walk = async (query: string, limit = 7) => {
      const ids: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 100; guard++) {
        const res: Awaited<ReturnType<Client['get']>> = await a().get(
          `/v1/assets?${query}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
        );
        expect(res.status, res.raw).toBe(200);
        ids.push(...res.body.data.map((r: { id: string }) => r.id));
        expect(res.body.data.length).toBeLessThanOrEqual(limit);
        cursor = res.body.page.next_cursor;
        expect(res.body.page.has_more).toBe(cursor !== null);
        if (!cursor) break;
      }
      return ids;
    };

    it.each([
      ['-created_at', 'created_at desc, id desc'],
      ['created_at', 'created_at asc, id asc'],
      ['asset_tag', 'lower(asset_tag) asc, id asc'],
      ['-asset_tag', 'lower(asset_tag) desc, id desc'],
      ['name,-asset_tag', `coalesce(lower(name), '') asc, lower(asset_tag) desc, id asc`],
      ['-purchase_date', `coalesce(purchase_date, date '0001-01-01') desc, id desc`],
      [
        'warranty_end,asset_tag',
        `coalesce(warranty_end, date '0001-01-01') asc, lower(asset_tag) asc, id asc`,
      ],
      ['-updated_at', 'updated_at desc, id desc'],
    ])('cursor pagination over sort=%s visits every row once, in order', async (sort, orderBy) => {
      const ids = await walk(`category_id=${cat.id}&sort=${encodeURIComponent(sort)}`);
      expect(ids).toHaveLength(N * 2);
      expect(new Set(ids).size).toBe(N * 2);
      const expected = await ownerTenantSql(
        t.tenantId,
        `select id from app.asset where category_id = $1 and archived_at is null order by ${orderBy}`,
        [cat.id],
      );
      expect(ids).toEqual(expected.rows.map((r: { id: string }) => r.id));
    });

    it('filters: status, state type, model, manufacturer, vendor, category (any of), archived', async () => {
      const ids = (q: string) =>
        a()
          .get(`/v1/assets?${q}&limit=200`)
          .then((r) => r.body.data.length as number);
      expect(await ids(`category_id=${cat.id}&status_id=${deployedId}`)).toBe(N);
      expect(await ids(`category_id=${cat.id}&state_type=deployed`)).toBe(N);
      expect(await ids(`category_id=${cat.id}&state_type=deployable,deployed`)).toBe(N * 2);
      expect(await ids(`category_id=${cat.id}&state_type=lost`)).toBe(0);
      expect(await ids(`model_id=${model.id}`)).toBe(N);
      expect(await ids(`manufacturer_id=${manufacturer.id}`)).toBe(N);
      expect(await ids(`vendor_id=${vendor.id}`)).toBe(N);
      const other2 = await category();
      expect(await ids(`category_id=${cat.id},${other2.id}&vendor_id=${vendor.id}`)).toBe(N);
      expect(await ids(`category_id=${other2.id}`)).toBe(0);
      expect(await ids(`category_id=${cat.id}&archived=only`)).toBe(0);
      const range = await a().get(
        `/v1/assets?category_id=${cat.id}&purchase_date_from=2024-02-01&purchase_date_to=2024-02-29&limit=200`,
      );
      for (const r of range.body.data)
        expect(r.purchase_date >= '2024-02-01' && r.purchase_date <= '2024-02-29').toBe(true);
      expect(range.body.data.length).toBeGreaterThan(0);
      expect(await ids(`category_id=${cat.id}&updated_since=2999-01-01T00:00:00Z`)).toBe(0);
      expect(
        await ids(
          `category_id=${cat.id}&warranty_end_before=2027-01-31&warranty_end_after=2027-01-01`,
        ),
      ).toBeGreaterThan(0);
    });

    it('text search matches tag, serial and name (substring, case-insensitive) and treats % and _ literally', async () => {
      const count = (q: string) =>
        a()
          .get(
            `/v1/assets?category_id=${cat.id}&q=${encodeURIComponent(q)}&limit=200&include_total=true`,
          )
          .then((r) => r.body.page.total as number);
      expect(await count('LST-000001')).toBe(1);
      expect(await count('lst-0000')).toBeGreaterThan(9);
      expect(await count('Bulk asset 5')).toBeGreaterThan(0);
      expect(await count('SER-LST-1')).toBeGreaterThan(0);
      expect(await count('BULK ASSET 5')).toBeGreaterThan(0);
      expect(await count('keycap')).toBe(0); // notes are not searched (contract: tag, serial, name)
      expect(await count('%')).toBe(0);
      expect(await count('_')).toBe(0);
      expect(await count('no such thing')).toBe(0);
    });

    it('custom field filters use JSONB containment: select, number, boolean, multiselect', async () => {
      const gold = await a().post('/v1/assets', {
        category_id: cat.id,
        custom_data: { tier: 'gold', n: 7, even: false, flags: ['x', 'y'] },
      });
      await a().post('/v1/assets', {
        category_id: cat.id,
        custom_data: { tier: 'silver', n: 8, even: true, flags: ['y'] },
      });
      const q = async (cf: string) =>
        (await a().get(`/v1/assets?category_id=${cat.id}&${cf}&limit=200&include_total=true`)).body;
      expect((await q('cf[tier]=gold')).data.map((r: { id: string }) => r.id)).toEqual([
        gold.body.id,
      ]);
      expect((await q('cf[tier]=silver')).page.total).toBe(1);
      expect((await q('cf[n]=7')).data[0].id).toBe(gold.body.id);
      expect((await q('cf[even]=false&cf[tier]=gold')).data).toHaveLength(1);
      expect((await q('cf[flags]=x')).data).toHaveLength(1);
      expect((await q('cf[flags]=y')).page.total).toBe(2);
      expect((await q('cf[tier]=bronze')).data).toHaveLength(0);
      const unknown = await a().get(`/v1/assets?cf[nope]=1`);
      expect(unknown.status).toBe(400);
      expect((await a().get('/v1/assets?cf[n]=abc')).status).toBe(400);
    });

    it('include_total, sparse fields and expand', async () => {
      const res = await a().get(
        `/v1/assets?model_id=${model.id}&limit=2&include_total=true&fields=asset_tag,status&expand=model,category,vendor`,
      );
      expect(res.status, res.raw).toBe(200);
      expect(res.body.page.total).toBe(N);
      expect(Object.keys(res.body.data[0]).sort()).toEqual(['asset_tag', 'id', 'status']);
      const full = await a().get(
        `/v1/assets?model_id=${model.id}&limit=1&expand=model,category,vendor`,
      );
      expect(full.body.data[0].expanded.model.id).toBe(model.id);
      expect(full.body.data[0].expanded.category.id).toBe(cat.id);
      expect(full.body.data[0].expanded.vendor.id).toBe(vendor.id);
      const one = await a().get(`/v1/assets/${full.body.data[0].id}?expand=model`);
      expect(one.body.expanded.model.name).toBeTruthy();
      expect((await a().get('/v1/assets?fields=nope')).status).toBe(400);
      expect((await a().get('/v1/assets?expand=nope')).status).toBe(400);
      expect(res.body.page.total).toBeDefined();
      expect((await a().get('/v1/assets?limit=3')).body.page.total).toBeUndefined();
    });

    it('rejects bad queries (400), M2-only filters, and a cursor from another sort or filter', async () => {
      expect((await a().get('/v1/assets?limit=0')).status).toBe(400);
      expect((await a().get('/v1/assets?limit=201')).status).toBe(400);
      expect((await a().get('/v1/assets?sort=serial')).status).toBe(400);
      expect((await a().get('/v1/assets?category_id=nope')).status).toBe(400);
      expect((await a().get('/v1/assets?assigned=true')).status).toBe(400);
      expect((await a().get('/v1/assets?cursor=garbage')).body.code).toBe('invalid-cursor');
      const page = await a().get(`/v1/assets?category_id=${cat.id}&limit=2`);
      const cursor = page.body.page.next_cursor;
      expect(
        (await a().get(`/v1/assets?category_id=${cat.id}&limit=2&sort=asset_tag&cursor=${cursor}`))
          .body.code,
      ).toBe('invalid-cursor');
      expect((await a().get(`/v1/assets?limit=2&cursor=${cursor}`)).body.code).toBe(
        'invalid-cursor',
      );
      expect(
        (await a().get(`/v1/assets?category_id=${cat.id}&limit=2&cursor=${cursor}`)).status,
      ).toBe(200);
      // a forged cursor with the right binding but values PostgreSQL cannot cast is a 400, not a 500
      const forged = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      forged.k[0] = 'not-a-timestamp';
      const bad = await a().get(
        `/v1/assets?category_id=${cat.id}&limit=2&cursor=${Buffer.from(JSON.stringify(forged)).toString('base64url')}`,
      );
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('invalid-cursor');
    });

    it("never returns another tenant's rows, even for the same tags", async () => {
      const oc = await other.admin.post('/v1/categories', {
        name: unique('OC'),
        tag_prefix: 'LST-',
      });
      await insertAssets(other.tenantId, oc.body.id, await defaultStatusId(other.admin), 5, {
        tagPrefix: 'LST-',
      });
      const mine = await walk(`q=LST-&category_id=${cat.id}`, 50);
      const theirs = (await other.admin.get('/v1/assets?q=LST-&limit=200')).body.data.map(
        (r: { id: string }) => r.id,
      );
      expect(theirs).toHaveLength(5);
      expect(mine.some((id) => theirs.includes(id))).toBe(false);
      expect((await a().get(`/v1/assets?category_id=${oc.body.id}`)).body.data).toEqual([]);
    });
  });

  describe('exact lookup, search and scan (REG-08)', () => {
    let cat: { id: string };
    let asset: { id: string; asset_tag: string; label_code: string };
    beforeAll(async () => {
      cat = await category('LK-');
      asset = (
        await a().post('/v1/assets', {
          category_id: cat.id,
          name: 'Quasar workstation',
          serial: 'ZX81-ABC',
        })
      ).body;
      await a().post('/v1/assets', {
        category_id: cat.id,
        name: 'Quasar spare',
        serial: 'ZX81-ABCD',
        asset_tag: 'LK-QUASAR',
      });
      await a().post('/v1/assets', {
        category_id: cat.id,
        name: 'Other',
        serial: 'MID-ZX81-ABC-2',
      });
    });

    it('GET /v1/assets?tag= and ?serial= are exact and case-insensitive', async () => {
      const byTag = await a().get(`/v1/assets?tag=${asset.asset_tag.toLowerCase()}`);
      expect(byTag.body.data.map((r: { id: string }) => r.id)).toEqual([asset.id]);
      const bySerial = await a().get('/v1/assets?serial=zx81-abc');
      expect(bySerial.body.data.map((r: { id: string }) => r.id)).toEqual([asset.id]);
      expect((await a().get('/v1/assets?tag=LK-0000')).body.data).toEqual([]);
      expect((await a().get('/v1/assets?tag=LK')).body.data).toEqual([]);
    });

    it('GET /v1/search ranks exact tag/serial first, then prefix, then substring', async () => {
      const res = await a().get('/v1/search?q=zx81-abc');
      expect(res.status, res.raw).toBe(200);
      const assets = res.body.data.filter((r: { type: string }) => r.type === 'asset');
      expect(assets.map((r: { sublabel: string }) => r.sublabel)).toEqual([
        'Quasar workstation',
        'Quasar spare',
        'Other',
      ]);
      expect(assets[0]).toMatchObject({
        type: 'asset',
        id: asset.id,
        label: asset.asset_tag,
        href_hint: `/assets/view?id=${asset.id}`,
      });
      const byTag = await a().get(`/v1/search?q=${asset.asset_tag}&types=asset`);
      expect(byTag.body.data[0].id).toBe(asset.id);
      expect(
        (await a().get('/v1/search?q=ZX81&limit=2')).body.data.filter(
          (r: { type: string }) => r.type === 'asset',
        ),
      ).toHaveLength(2);
    });

    it('search also returns models and categories, honours types, and leaves out archived records', async () => {
      const { category: c, model } = await seedBasics(a());
      const res = await a().get(`/v1/search?q=${encodeURIComponent(model.name)}`);
      expect(
        res.body.data
          .filter((r: { type: string }) => r.type === 'model')
          .map((r: { id: string }) => r.id),
      ).toEqual([model.id]);
      const cats = await a().get(`/v1/search?q=${encodeURIComponent(c.name)}&types=category`);
      expect(cats.body.data.map((r: { type: string }) => r.type)).toEqual(['category']);
      expect(cats.body.data[0].href_hint).toBe(`/categories/view?id=${c.id}`);
      expect(
        (await a().get(`/v1/search?q=${encodeURIComponent(c.name)}&types=person,location`)).body
          .data,
      ).toEqual([]);
      expect((await a().get('/v1/search')).status).toBe(400);
      expect((await a().get('/v1/search?q=x&types=nope')).status).toBe(400);
      expect((await a().get('/v1/search?q=x&limit=51')).status).toBe(400);
      const gone = await a().post('/v1/assets', {
        category_id: cat.id,
        name: 'Zebrafish archived',
      });
      await a().del(`/v1/assets/${gone.body.id}`, undefined, im(gone));
      expect((await a().get('/v1/search?q=Zebrafish')).body.data).toEqual([]);
      expect((await a().get('/v1/search?q=%25')).body.data).toEqual([]);
    });

    it('search filters by permission per type: a key with only catalog:read sees no assets', async () => {
      const key = await a().post('/v1/api-keys', {
        name: 'search-catalog',
        scopes: ['search:read', 'catalog:read'],
      });
      const bearer = {
        headers: { authorization: `Bearer ${key.body.secret}` },
        cookie: false,
      } as const;
      const c = new Client(app);
      const res = await c.get('/v1/search?q=Quasar', bearer);
      expect(res.status, res.raw).toBe(200);
      expect(res.body.data.some((r: { type: string }) => r.type === 'asset')).toBe(false);
      const cats = await c.get(
        `/v1/search?q=${encodeURIComponent((await a().get(`/v1/categories/${cat.id}`)).body.name)}`,
        bearer,
      );
      expect(cats.body.data.some((r: { type: string }) => r.type === 'category')).toBe(true);
      const assetsKey = await a().post('/v1/api-keys', {
        name: 'search-assets',
        scopes: ['search:read', 'asset:read'],
      });
      const bearer2 = {
        headers: { authorization: `Bearer ${assetsKey.body.secret}` },
        cookie: false,
      } as const;
      const res2 = await c.get('/v1/search?q=Quasar', bearer2);
      expect(res2.body.data.every((r: { type: string }) => r.type === 'asset')).toBe(true);
      expect(res2.body.data.length).toBeGreaterThan(0);
    });

    it('GET /v1/scan/resolve takes a label code, a tag, or a label URL; 404 otherwise and across tenants', async () => {
      const byLabel = await a().get(`/v1/scan/resolve?code=${asset.label_code}`);
      expect(byLabel.status, byLabel.raw).toBe(200);
      expect(byLabel.body).toMatchObject({
        match_type: 'label_code',
        asset: { id: asset.id },
        allowed_actions: ['update'],
      });
      const byTag = await a().get(`/v1/scan/resolve?code=${asset.asset_tag.toLowerCase()}`);
      expect(byTag.body).toMatchObject({ match_type: 'asset_tag', asset: { id: asset.id } });
      const byUrl = await a().get(
        `/v1/scan/resolve?code=${encodeURIComponent(`https://app.example/a/${asset.label_code}?x=1`)}`,
      );
      expect(byUrl.body.match_type).toBe('label_code');
      expect((await a().get('/v1/scan/resolve?code=nothing')).status).toBe(404);
      expect((await other.admin.get(`/v1/scan/resolve?code=${asset.label_code}`)).status).toBe(404);
      expect((await other.admin.get(`/v1/scan/resolve?code=${asset.asset_tag}`)).status).toBe(404);
      expect(
        (await viewer.client.get(`/v1/scan/resolve?code=${asset.label_code}`)).body.allowed_actions,
      ).toEqual([]);
      expect((await a().get('/v1/scan/resolve')).status).toBe(400);
    });
  });

  describe('regressions found in review', () => {
    it('sorting assets descending does not change the cursor of other lists (shared id tiebreaker)', async () => {
      const first = await a().get('/v1/categories?limit=1');
      expect(first.body.page.next_cursor).toBeTruthy();
      await a().get('/v1/assets?limit=2'); // default sort -created_at
      const next = await a().get(`/v1/categories?limit=1&cursor=${first.body.page.next_cursor}`);
      expect(next.status, next.raw).toBe(200);
    });

    it('crafted input is a 4xx, never a 500: NUL bytes, year 0000, impossible dates in a cursor', async () => {
      const cat = await category();
      for (const url of [
        '/v1/assets?q=%00',
        '/v1/assets?tag=%00',
        '/v1/scan/resolve?code=%00',
        '/v1/search?q=%00',
        '/v1/assets?warranty_end_before=0000-01-01',
        '/v1/assets?updated_since=0000-01-01T00:00:00Z',
      ]) {
        const res = await a().get(url);
        expect(res.status, url).toBe(400);
      }
      for (const body of [
        { category_id: cat.id, name: 'a\u0000b' },
        { category_id: cat.id, purchase_date: '0000-01-01' },
        { category_id: cat.id, custom_data: { x: 'a\u0000b' } },
      ]) {
        expect((await a().post('/v1/assets', body)).status).toBe(422);
      }
      const page = await a().get(`/v1/assets?category_id=${cat.id}&limit=1`);
      await a().post('/v1/assets', { category_id: cat.id });
      await a().post('/v1/assets', { category_id: cat.id });
      const real = (await a().get(`/v1/assets?category_id=${cat.id}&limit=1`)).body.page
        .next_cursor;
      expect(page.status).toBe(200);
      for (const forgedValue of [
        '2024-13-45T00:00:00.000000+00',
        '0000-01-01T00:00:00.000000+00',
      ]) {
        const forged = JSON.parse(Buffer.from(real, 'base64url').toString('utf8'));
        forged.k[0] = forgedValue;
        const res = await a().get(
          `/v1/assets?category_id=${cat.id}&limit=1&cursor=${Buffer.from(JSON.stringify(forged)).toString('base64url')}`,
        );
        expect(res.status, forgedValue).toBe(400);
      }
    });

    it('a custom field list keeps both the text filter and the category filter', async () => {
      const cat = await category();
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'zq_alpha',
        label: 'Alpha',
        data_type: 'text',
      });
      await a().post('/v1/custom-fields', {
        category_id: cat.id,
        key: 'zq_beta',
        label: 'Beta',
        data_type: 'text',
      });
      const res = await a().get(`/v1/custom-fields?category_id=${cat.id}&q=alpha`);
      expect(res.body.data.map((d: { key: string }) => d.key)).toEqual(['zq_alpha']);
    });

    it('archived catalogue rows cannot be edited (an archived status label cannot become the default)', async () => {
      const label = await a().post('/v1/status-labels', {
        name: unique('Old'),
        state_type: 'deployable',
      });
      expect(
        (await a().del(`/v1/status-labels/${label.body.id}`, undefined, im(label))).status,
      ).toBe(204);
      const res = await a().patch(
        `/v1/status-labels/${label.body.id}`,
        { is_default: true },
        im('*'),
      );
      expect(res.status).toBe(404);
      const labels = (await a().get('/v1/status-labels')).body.data;
      expect(labels.filter((l: { is_default: boolean }) => l.is_default)).toHaveLength(1);
    });

    it('a tag containing "/" resolves as itself; a label URL still yields its last segment', async () => {
      const cat = await category();
      const slash = await a().post('/v1/assets', {
        category_id: cat.id,
        asset_tag: unique('SITE').toUpperCase() + '/001',
      });
      expect(slash.status, slash.raw).toBe(201);
      const res = await a().get(
        `/v1/scan/resolve?code=${encodeURIComponent(slash.body.asset_tag)}`,
      );
      expect(res.body.asset.id).toBe(slash.body.id);
      const url = await a().get(
        `/v1/scan/resolve?code=${encodeURIComponent(`https://x.example/a/${slash.body.label_code}`)}`,
      );
      expect(url.body.asset.id).toBe(slash.body.id);
    });
  });
});
