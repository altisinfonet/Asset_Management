import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import {
  type App,
  type TenantFixture,
  type UserFixture,
  auditRows,
  createTenant,
  createUser,
  newTenancy,
  outboxRows,
  seedBasics,
  startRegistryApp,
  unique,
} from './support.js';

/** M1-REG-01..04, REG-11: categories, manufacturers, models, status labels, vendors, custom fields. */
describe.skipIf(!dbEnabled)('registry catalog', () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;
  let viewer: UserFixture;
  let manager: UserFixture;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'catalog');
    other = await createTenant(app, tenancy, 'catalogb');
    viewer = await createUser(app, t, 'viewer');
    manager = await createUser(app, t, 'asset_manager');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
  });

  const ifMatch = (res: { headers: Record<string, unknown> }) => ({
    headers: { 'if-match': String(res.headers.etag) },
  });

  describe('categories (REG-01)', () => {
    it('CRUD with ETag, Location, audit and outbox in the same transaction', async () => {
      const a = t.admin;
      const name = unique('Cat');
      const created = await a.post('/v1/categories', { name, tag_prefix: 'XC-', description: 'd' });
      expect(created.status, created.raw).toBe(201);
      expect(created.headers.etag).toMatch(/^W\/"1"$/);
      expect(created.headers.location).toBe(`/v1/categories/${created.body.id}`);
      expect(created.body).toMatchObject({
        name,
        kind: 'asset',
        tag_prefix: 'XC-',
        description: 'd',
        archived_at: null,
      });

      const got = await a.get(`/v1/categories/${created.body.id}`);
      expect(got.status).toBe(200);
      expect(got.headers.etag).toBe(created.headers.etag);

      const patched = await a.patch(
        `/v1/categories/${created.body.id}`,
        { description: null, name: `${name} 2` },
        ifMatch(created),
      );
      expect(patched.status, patched.raw).toBe(200);
      expect(patched.headers.etag).toBe('W/"2"');
      expect(patched.body).toMatchObject({ name: `${name} 2`, description: null });

      const audit = await auditRows(t.tenantId, `entity_id = '${created.body.id}'`);
      expect(audit.map((r) => r.action)).toEqual(['category.created', 'category.updated']);
      expect(audit[1]!.diff!.before).toMatchObject({ name, description: 'd' });
      expect(audit[1]!.diff!.after).toMatchObject({ name: `${name} 2`, description: null });
      expect(audit[0]!.request_id).toBeTruthy();
      const events = await outboxRows(t.tenantId, `aggregate_id = '${created.body.id}'`);
      expect(events.map((e) => e.event_type)).toEqual(['category.created', 'category.updated']);
      expect(events[1]!.payload).toMatchObject({ version: 2 });
    });

    it('PATCH needs If-Match (428) and refuses a stale one (412)', async () => {
      const c = await t.admin.post('/v1/categories', { name: unique('Cat') });
      expect(
        (await t.admin.patch(`/v1/categories/${c.body.id}`, { description: 'x' })).status,
      ).toBe(428);
      expect(
        (
          await t.admin.patch(
            `/v1/categories/${c.body.id}`,
            { description: 'x' },
            { headers: { 'if-match': 'W/"9"' } },
          )
        ).status,
      ).toBe(412);
      expect((await t.admin.del(`/v1/categories/${c.body.id}`)).status).toBe(428);
    });

    it('names are unique per tenant (409), but another tenant may reuse them', async () => {
      const name = unique('Dup');
      expect((await t.admin.post('/v1/categories', { name })).status).toBe(201);
      const dup = await t.admin.post('/v1/categories', { name: name.toUpperCase() });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('conflict');
      expect(dup.body.errors[0]).toMatchObject({ pointer: '/name', code: 'duplicate' });
      expect((await other.admin.post('/v1/categories', { name })).status).toBe(201);
    });

    it('validates the body (422 with pointers), the kind is fixed at creation', async () => {
      const bad = await t.admin.post('/v1/categories', { name: '', tag_prefix: 'lower', extra: 1 });
      expect(bad.status).toBe(422);
      expect(bad.body.errors.map((e: { pointer: string }) => e.pointer).sort()).toEqual(
        ['/', '/name', '/tag_prefix'].sort(),
      );
      const c = await t.admin.post('/v1/categories', { name: unique('K') });
      const kind = await t.admin.patch(
        `/v1/categories/${c.body.id}`,
        { kind: 'license' },
        ifMatch(c),
      );
      expect(kind.status).toBe(422);
      expect(kind.body.errors[0]).toMatchObject({ pointer: '/kind', code: 'immutable' });
    });

    it('listing: search, kind filter, sort, cursor pagination and total', async () => {
      const prefix = unique('Lst');
      for (const n of ['b', 'a', 'c'])
        await t.admin.post('/v1/categories', { name: `${prefix}-${n}` });
      const all = await t.admin.get(`/v1/categories?q=${prefix}&include_total=true&limit=2`);
      expect(all.status).toBe(200);
      expect(all.body.data.map((c: { name: string }) => c.name)).toEqual([
        `${prefix}-a`,
        `${prefix}-b`,
      ]);
      expect(all.body.page).toMatchObject({ has_more: true, total: 3 });
      const next = await t.admin.get(
        `/v1/categories?q=${prefix}&limit=2&cursor=${all.body.page.next_cursor}`,
      );
      expect(next.body.data.map((c: { name: string }) => c.name)).toEqual([`${prefix}-c`]);
      expect(next.body.page.has_more).toBe(false);
      expect((await t.admin.get(`/v1/categories?q=${prefix}&sort=-name`)).body.data[0].name).toBe(
        `${prefix}-c`,
      );
      expect((await t.admin.get('/v1/categories?kind=license')).body.data).toEqual([]);
      expect((await t.admin.get('/v1/categories?sort=bogus')).status).toBe(400);
    });

    it('refuses to delete a category in use and lists the counts; archives an unused one', async () => {
      const { category, model } = await seedBasics(t.admin);
      const asset = await t.admin.post('/v1/assets', {
        category_id: category.id,
        model_id: model.id,
      });
      expect(asset.status, asset.raw).toBe(201);
      const cat = await t.admin.get(`/v1/categories/${category.id}`);
      const refused = await t.admin.del(`/v1/categories/${category.id}`, undefined, ifMatch(cat));
      expect(refused.status).toBe(409);
      expect(refused.body.usage).toMatchObject({ assets: 1, models: 1 });
      expect(refused.body.detail).toMatch(/assets: 1/);

      const free = await t.admin.post('/v1/categories', { name: unique('Free') });
      const gone = await t.admin.del(`/v1/categories/${free.body.id}`, undefined, ifMatch(free));
      expect(gone.status).toBe(204);
      expect((await t.admin.get(`/v1/categories/${free.body.id}`)).body.archived_at).not.toBeNull();
      expect((await t.admin.get(`/v1/categories?q=${free.body.name}`)).body.data).toEqual([]);
      expect(
        (await t.admin.get(`/v1/categories?q=${free.body.name}&archived=only`)).body.data,
      ).toHaveLength(1);
      expect(
        (await auditRows(t.tenantId, `entity_id = '${free.body.id}'`)).map((r) => r.action),
      ).toContain('category.archived');
    });

    it('permissions: viewers read, only catalog:manage writes', async () => {
      expect((await viewer.client.get('/v1/categories')).status).toBe(200);
      expect((await viewer.client.post('/v1/categories', { name: unique('V') })).status).toBe(403);
      expect((await manager.client.post('/v1/categories', { name: unique('M') })).status).toBe(201);
    });
  });

  describe('manufacturers and models (REG-02)', () => {
    it('manufacturer CRUD, uniqueness, optional contact fields validated', async () => {
      const name = unique('Maker');
      const m = await t.admin.post('/v1/manufacturers', {
        name,
        support_email: 'help@maker.example',
        url: 'https://maker.example',
      });
      expect(m.status, m.raw).toBe(201);
      expect((await t.admin.post('/v1/manufacturers', { name })).status).toBe(409);
      const bad = await t.admin.post('/v1/manufacturers', {
        name: unique('X'),
        support_email: 'nope',
        url: 'ftp',
      });
      expect(bad.status).toBe(422);
      const upd = await t.admin.patch(`/v1/manufacturers/${m.body.id}`, { notes: 'n' }, ifMatch(m));
      expect(upd.body.notes).toBe('n');
      expect(
        (await t.admin.get(`/v1/manufacturers?q=${name.slice(0, 8)}`)).body.data.length,
      ).toBeGreaterThan(0);
    });

    it('models: filters by category and manufacturer, text search, composite uniqueness', async () => {
      const { category, manufacturer, model } = await seedBasics(t.admin);
      const byCat = await t.admin.get(`/v1/models?category_id=${category.id}`);
      expect(byCat.body.data.map((x: { id: string }) => x.id)).toEqual([model.id]);
      const byMan = await t.admin.get(
        `/v1/models?manufacturer_id=${manufacturer.id}&q=${model.name.slice(0, 6)}`,
      );
      expect(byMan.body.data).toHaveLength(1);
      expect(
        (await t.admin.get(`/v1/models?manufacturer_id=${manufacturer.id}&q=zzzzzz`)).body.data,
      ).toHaveLength(0);
      const dup = await t.admin.post('/v1/models', {
        category_id: category.id,
        manufacturer_id: manufacturer.id,
        name: model.name.toUpperCase(),
        model_number: model.model_number,
      });
      expect(dup.status).toBe(409);
      const sameNameOtherNumber = await t.admin.post('/v1/models', {
        category_id: category.id,
        manufacturer_id: manufacturer.id,
        name: model.name,
        model_number: 'OTHER',
        default_depreciation_months: 36,
        eol_date: '2030-01-31',
      });
      expect(sameNameOtherNumber.status, sameNameOtherNumber.raw).toBe(201);
      expect(sameNameOtherNumber.body).toMatchObject({
        default_depreciation_months: 36,
        eol_date: '2030-01-31',
      });
    });

    it('models validate their references (422) and refuse deleting a used manufacturer or model', async () => {
      const { category, manufacturer, model } = await seedBasics(t.admin);
      const noCat = await t.admin.post('/v1/models', {
        category_id: crypto.randomUUID(),
        name: unique('M'),
      });
      expect(noCat.status).toBe(422);
      expect(noCat.body.errors[0]).toMatchObject({ pointer: '/category_id' });
      const foreignCat = await other.admin.post('/v1/categories', { name: unique('Foreign') });
      const crossTenant = await t.admin.post('/v1/models', {
        category_id: foreignCat.body.id,
        name: unique('M'),
      });
      expect(crossTenant.status).toBe(422);
      const badMan = await t.admin.post('/v1/models', {
        category_id: category.id,
        manufacturer_id: crypto.randomUUID(),
        name: unique('M'),
      });
      expect(badMan.body.errors[0]).toMatchObject({ pointer: '/manufacturer_id' });

      const man = await t.admin.get(`/v1/manufacturers/${manufacturer.id}`);
      const refused = await t.admin.del(
        `/v1/manufacturers/${manufacturer.id}`,
        undefined,
        ifMatch(man),
      );
      expect(refused.status).toBe(409);
      expect(refused.body.usage).toEqual({ models: 1 });

      await t.admin.post('/v1/assets', { category_id: category.id, model_id: model.id });
      const m = await t.admin.get(`/v1/models/${model.id}`);
      const used = await t.admin.del(`/v1/models/${model.id}`, undefined, ifMatch(m));
      expect(used.status).toBe(409);
      expect(used.body.usage).toEqual({ assets: 1 });
      const moveCat = await t.admin.post('/v1/categories', { name: unique('Other') });
      const move = await t.admin.patch(
        `/v1/models/${model.id}`,
        { category_id: moveCat.body.id },
        ifMatch(m),
      );
      expect(move.status).toBe(409);
    });
  });

  describe('vendors (REG-11)', () => {
    it('CRUD and refusal to delete a vendor in use, with counts', async () => {
      const v = await t.admin.post('/v1/vendors', {
        name: unique('Vendor'),
        contact_email: 'v@v.example',
        phone: '+1 555 0100',
        url: 'https://v.example',
      });
      expect(v.status, v.raw).toBe(201);
      expect((await t.admin.post('/v1/vendors', { name: v.body.name })).status).toBe(409);
      const { category } = await seedBasics(t.admin);
      const asset = await t.admin.post('/v1/assets', {
        category_id: category.id,
        vendor_id: v.body.id,
      });
      expect(asset.status, asset.raw).toBe(201);
      const refused = await t.admin.del(`/v1/vendors/${v.body.id}`, undefined, ifMatch(v));
      expect(refused.status).toBe(409);
      expect(refused.body.usage).toEqual({ assets: 1 });
      const free = await t.admin.post('/v1/vendors', { name: unique('Free') });
      expect(
        (await t.admin.del(`/v1/vendors/${free.body.id}`, undefined, ifMatch(free))).status,
      ).toBe(204);
    });
  });

  describe('status labels (REG-03, ED-02)', () => {
    it('ships a default label per state type, including undeployable', async () => {
      const list = await t.admin.get('/v1/status-labels');
      const types = new Set(list.body.data.map((s: { state_type: string }) => s.state_type));
      expect([...types].sort()).toEqual([
        'archived',
        'deployable',
        'deployed',
        'lost',
        'pending',
        'undeployable',
      ]);
      expect(list.body.data.filter((s: { is_default: boolean }) => s.is_default)).toHaveLength(1);
      const undeployable = await t.admin.get('/v1/status-labels?state_type=undeployable');
      expect(undeployable.body.data.map((s: { name: string }) => s.name).sort()).toEqual([
        'Broken',
        'In repair',
      ]);
      expect((await t.admin.get('/v1/status-labels?state_type=bogus')).status).toBe(400);
    });

    it('create / rename / reorder / recolour; the state type must be one of the fixed six', async () => {
      const created = await t.admin.post('/v1/status-labels', {
        name: unique('Quarantine'),
        state_type: 'undeployable',
        color: '#112233',
      });
      expect(created.status, created.raw).toBe(201);
      expect(created.body).toMatchObject({
        state_type: 'undeployable',
        color: '#112233',
        is_default: false,
      });
      const bad = await t.admin.post('/v1/status-labels', {
        name: unique('X'),
        state_type: 'in_repair',
      });
      expect(bad.status).toBe(422);
      expect(
        (
          await t.admin.post('/v1/status-labels', {
            name: unique('X'),
            state_type: 'lost',
            color: 'red',
          })
        ).status,
      ).toBe(422);
      const upd = await t.admin.patch(
        `/v1/status-labels/${created.body.id}`,
        { name: unique('Renamed'), position: 5, color: '#abcdef' },
        ifMatch(created),
      );
      expect(upd.body).toMatchObject({ position: 5, color: '#abcdef' });
      expect((await t.admin.get('/v1/status-labels?sort=position')).body.data[0].id).toBe(
        upd.body.id,
      );
      expect(
        (await t.admin.post('/v1/status-labels', { name: upd.body.name, state_type: 'lost' }))
          .status,
      ).toBe(409);
    });

    it('the default label can move but not disappear; labels in use and the last of a type cannot be deleted', async () => {
      const labels = (await t.admin.get('/v1/status-labels')).body.data as Array<{
        id: string;
        name: string;
        state_type: string;
        is_default: boolean;
      }>;
      const def = labels.find((l) => l.is_default)!;
      const defRes = await t.admin.get(`/v1/status-labels/${def.id}`);
      const del = await t.admin.del(`/v1/status-labels/${def.id}`, undefined, ifMatch(defRes));
      expect(del.status).toBe(409);
      expect(del.body.detail).toMatch(/default/);

      const lost = labels.find((l) => l.state_type === 'lost')!;
      const lostRes = await t.admin.get(`/v1/status-labels/${lost.id}`);
      const last = await t.admin.del(`/v1/status-labels/${lost.id}`, undefined, ifMatch(lostRes));
      expect(last.status).toBe(409);
      expect(last.body.detail).toMatch(/only lost label/);

      // a second deployable label becomes the default; the first one is no longer
      const second = await t.admin.post('/v1/status-labels', {
        name: unique('Spare'),
        state_type: 'deployable',
        is_default: true,
      });
      expect(second.status, second.raw).toBe(201);
      expect(
        (await t.admin.get('/v1/status-labels')).body.data
          .filter((l: { is_default: boolean }) => l.is_default)
          .map((l: { id: string }) => l.id),
      ).toEqual([second.body.id]);
      // lost / archived states cannot be the default for new assets
      const final = await t.admin.patch(
        `/v1/status-labels/${lost.id}`,
        { is_default: true },
        ifMatch(lostRes),
      );
      expect(final.status).toBe(422);

      // in use: an asset takes the label
      const { category } = await seedBasics(t.admin);
      await t.admin.post('/v1/assets', { category_id: category.id, status_id: second.body.id });
      const refused = await t.admin.del(
        `/v1/status-labels/${labels.find((l) => l.name === 'Ready to deploy')!.id}`,
        undefined,
        {
          headers: { 'if-match': '*' },
        },
      );
      expect(refused.status).toBe(409);
      const spare = await t.admin.post('/v1/status-labels', {
        name: unique('Spare2'),
        state_type: 'deployable',
      });
      await t.admin.post('/v1/assets', { category_id: category.id, status_id: spare.body.id });
      const inUse = await t.admin.del(
        `/v1/status-labels/${spare.body.id}`,
        undefined,
        ifMatch(spare),
      );
      expect(inUse.status).toBe(409);
      expect(inUse.body.usage).toEqual({ assets: 1 });
      // changing the state type of a used label is refused too
      expect(
        (
          await t.admin.patch(
            `/v1/status-labels/${spare.body.id}`,
            { state_type: 'pending' },
            ifMatch(spare),
          )
        ).status,
      ).toBe(409);
    });

    it('business rules reference the state type, not the label name (renames change nothing)', async () => {
      const { category } = await seedBasics(t.admin);
      const label = await t.admin.post('/v1/status-labels', {
        name: unique('Before'),
        state_type: 'deployed',
      });
      const a = await t.admin.post('/v1/assets', {
        category_id: category.id,
        status_id: label.body.id,
      });
      await t.admin.patch(
        `/v1/status-labels/${label.body.id}`,
        { name: unique('After') },
        ifMatch(label),
      );
      const list = await t.admin.get(`/v1/assets?state_type=deployed&category_id=${category.id}`);
      expect(list.body.data.map((x: { id: string }) => x.id)).toEqual([a.body.id]);
      expect(list.body.data[0].status.state_type).toBe('deployed');
    });
  });

  describe('custom field definitions (REG-04)', () => {
    it('creates typed definitions per category and validates the definition itself', async () => {
      const cat = await t.admin.post('/v1/categories', { name: unique('CF') });
      const sel = await t.admin.post('/v1/custom-fields', {
        category_id: cat.body.id,
        key: 'os',
        label: 'OS',
        data_type: 'select',
        options: [{ value: 'macOS' }, { value: 'Linux', label: 'Linux (any)' }],
        required: true,
        help_text: 'pick',
        show_in_list: true,
      });
      expect(sel.status, sel.raw).toBe(201);
      expect(sel.body).toMatchObject({
        key: 'os',
        data_type: 'select',
        required: true,
        category_id: cat.body.id,
        show_in_list: true,
      });
      expect(sel.body.options).toEqual([
        { value: 'macOS' },
        { value: 'Linux', label: 'Linux (any)' },
      ]);
      const bad = await t.admin.post('/v1/custom-fields', {
        category_id: cat.body.id,
        key: 'Bad Key',
        label: 'x',
        data_type: 'select',
      });
      expect(bad.status).toBe(422);
      const noOptions = await t.admin.post('/v1/custom-fields', {
        category_id: cat.body.id,
        key: 'k2',
        label: 'x',
        data_type: 'select',
      });
      expect(noOptions.body.errors[0]).toMatchObject({ pointer: '/options', code: 'required' });
      const badRule = await t.admin.post('/v1/custom-fields', {
        category_id: cat.body.id,
        key: 'k3',
        label: 'x',
        data_type: 'number',
        validation: { pattern: 'x' },
      });
      expect(badRule.body.errors[0]).toMatchObject({
        pointer: '/validation/pattern',
        code: 'unknown-field',
      });
      expect(
        (
          await t.admin.post('/v1/custom-fields', {
            category_id: cat.body.id,
            key: 'os',
            label: 'dup',
            data_type: 'text',
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await t.admin.post('/v1/custom-fields', {
            category_id: crypto.randomUUID(),
            key: 'zz',
            label: 'x',
            data_type: 'text',
          })
        ).status,
      ).toBe(422);
      // the category list shows its own fields plus global ones
      const global = await t.admin.post('/v1/custom-fields', {
        key: unique('g')
          .replace(/-/g, '_')
          .toLowerCase()
          .replace(/^[^a-z]/, 'g'),
        label: 'Global',
        data_type: 'text',
      });
      expect(global.status, global.raw).toBe(201);
      const mine = await t.admin.get(`/v1/custom-fields?category_id=${cat.body.id}`);
      const keys = mine.body.data.map((d: { key: string }) => d.key);
      expect(keys).toContain('os');
      expect(keys).toContain(global.body.key);
      // the key of a global field cannot be reused by a category field
      expect(
        (
          await t.admin.post('/v1/custom-fields', {
            category_id: cat.body.id,
            key: global.body.key,
            label: 'c',
            data_type: 'text',
          })
        ).status,
      ).toBe(409);
    });

    it('the key is immutable; the type cannot change once values exist; archiving keeps values readable', async () => {
      const cat = await t.admin.post('/v1/categories', { name: unique('CF'), tag_prefix: 'CFX-' });
      const def = await t.admin.post('/v1/custom-fields', {
        category_id: cat.body.id,
        key: 'tier',
        label: 'Tier',
        data_type: 'text',
      });
      expect(
        (await t.admin.patch(`/v1/custom-fields/${def.body.id}`, { key: 'renamed' }, ifMatch(def)))
          .body.errors[0],
      ).toMatchObject({ pointer: '/key', code: 'immutable' });
      // no values yet: the type may change
      const retyped = await t.admin.patch(
        `/v1/custom-fields/${def.body.id}`,
        { data_type: 'number' },
        ifMatch(def),
      );
      expect(retyped.status, retyped.raw).toBe(200);
      const asset = await t.admin.post('/v1/assets', {
        category_id: cat.body.id,
        custom_data: { tier: 3 },
      });
      expect(asset.status, asset.raw).toBe(201);
      const refused = await t.admin.patch(
        `/v1/custom-fields/${def.body.id}`,
        { data_type: 'text' },
        ifMatch(retyped),
      );
      expect(refused.status).toBe(409);
      expect(refused.body.usage).toEqual({ assets_with_values: 1 });
      // label, position, required... still editable
      const relabel = await t.admin.patch(
        `/v1/custom-fields/${def.body.id}`,
        { label: 'Support tier', position: 7 },
        ifMatch(retyped),
      );
      expect(relabel.status).toBe(200);
      // archive: the value stays readable, new writes of the key are refused
      expect(
        (await t.admin.del(`/v1/custom-fields/${def.body.id}`, undefined, ifMatch(relabel))).status,
      ).toBe(204);
      const read = await t.admin.get(`/v1/assets/${asset.body.id}`);
      expect(read.body.custom_data).toEqual({ tier: 3 });
      const write = await t.admin.patch(
        `/v1/assets/${asset.body.id}`,
        { custom_data: { tier: 4 } },
        ifMatch(read),
      );
      expect(write.status).toBe(422);
      expect(write.body.errors[0]).toMatchObject({
        pointer: '/custom_data/tier',
        code: 'unknown-field',
      });
      const tier = (r: { body: { data: Array<{ key: string }> } }) =>
        r.body.data.filter((d) => d.key === 'tier');
      expect(tier(await t.admin.get(`/v1/custom-fields?category_id=${cat.body.id}`))).toEqual([]);
      expect(
        tier(await t.admin.get(`/v1/custom-fields?category_id=${cat.body.id}&archived=include`)),
      ).toHaveLength(1);
    });
  });

  describe('asset tag template (REG-06)', () => {
    it('GET shows the defaults and an example; PUT replaces it with If-Match and is audited', async () => {
      const a = t.admin;
      const got = await a.get('/v1/settings/asset-tag-template');
      expect(got.status, got.raw).toBe(200);
      expect(got.body).toMatchObject({
        prefix: '',
        width: 5,
        use_category_prefix: true,
        example: 'LAP-00042',
      });
      expect(
        (await a.request('PUT', '/v1/settings/asset-tag-template', { body: { prefix: 'AT-' } }))
          .status,
      ).toBe(428);
      const put = await a.request('PUT', '/v1/settings/asset-tag-template', {
        body: { prefix: 'AT-', width: 6, use_category_prefix: false },
        ...ifMatch(got),
      });
      expect(put.status, put.raw).toBe(200);
      expect(put.body).toMatchObject({
        prefix: 'AT-',
        width: 6,
        use_category_prefix: false,
        example: 'AT-000042',
      });
      const bad = await a.request('PUT', '/v1/settings/asset-tag-template', {
        body: { prefix: 'lower', width: 0 },
        ...ifMatch(put),
      });
      expect(bad.status).toBe(422);
      expect((await viewer.client.get('/v1/settings/asset-tag-template')).status).toBe(200);
      expect(
        (
          await viewer.client.request('PUT', '/v1/settings/asset-tag-template', {
            body: {},
            ...ifMatch(put),
          })
        ).status,
      ).toBe(403);
      const audit = await auditRows(
        t.tenantId,
        `action = 'tenant_settings.asset_tag_template_updated'`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.diff!.after).toMatchObject({ prefix: 'AT-', width: 6 });
      // restore the default for the other suites in this file
      await a.request('PUT', '/v1/settings/asset-tag-template', {
        body: { prefix: '', width: 5, use_category_prefix: true },
        ...ifMatch(put),
      });
    });
  });
});
