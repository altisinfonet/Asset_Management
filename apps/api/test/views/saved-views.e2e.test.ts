import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type App,
  type TenantFixture,
  auditRows,
  contractViolations,
  createTenant,
  createUser,
  ifMatch,
  newTenancy,
  startRegistryApp,
  unique,
} from '../lifecycle/support.js';

/** M2-REG-01: saved views, private and shared. */
describe.skipIf(!dbEnabled)(`saved views (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;
  const a = () => t.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'views');
    other = await createTenant(app, tenancy, 'views2');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const body = (extra: Record<string, unknown> = {}) => ({
    name: unique('View'),
    filters: { q: 'laptop', archived: 'exclude' },
    columns: ['tag', 'name', 'status'],
    sort: '-created_at',
    ...extra,
  });

  it('creates, reads, renames, changes and deletes a private view', async () => {
    const res = await a().post('/v1/saved-views', body({ name: 'Laptops' }));
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/v1/saved-views/${res.body.id}`);
    expect(res.body).toMatchObject({
      resource: 'assets',
      name: 'Laptops',
      filters: { q: 'laptop', archived: 'exclude' },
      columns: ['tag', 'name', 'status'],
      sort: '-created_at',
      is_shared: false,
      is_owner: true,
      owner: { display_name: expect.any(String) },
      warnings: [],
    });
    const got = await a().get(`/v1/saved-views/${res.body.id}`);
    expect(got.status).toBe(200);
    expect(got.headers.etag).toBe(res.headers.etag);

    expect((await a().patch(`/v1/saved-views/${res.body.id}`, { name: 'x' })).status).toBe(428);
    const up = await a().patch(
      `/v1/saved-views/${res.body.id}`,
      { name: 'Old laptops', sort: null, filters: { q: 'old' } },
      ifMatch(res.headers.etag),
    );
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({
      name: 'Old laptops',
      sort: null,
      filters: { q: 'old' },
      columns: ['tag', 'name', 'status'],
    });
    expect(
      (await a().patch(`/v1/saved-views/${res.body.id}`, { name: 'y' }, ifMatch(res.headers.etag)))
        .status,
    ).toBe(412);

    const del = await a().del(
      `/v1/saved-views/${res.body.id}`,
      undefined,
      ifMatch(up.headers.etag),
    );
    expect(del.status).toBe(204);
    expect((await a().get(`/v1/saved-views/${res.body.id}`)).status).toBe(404);
    expect(
      (await auditRows(t.tenantId, `entity_id = '${res.body.id}'`)).map((r) => r.action),
    ).toEqual(['saved_view.created', 'saved_view.updated', 'saved_view.deleted']);
  });

  it('names are unique per user (case-insensitive), not across users; defaults and bounds apply', async () => {
    const u1 = await createUser(app, t, 'viewer');
    const u2 = await createUser(app, t, 'viewer');
    const name = unique('Same');
    expect((await u1.client.post('/v1/saved-views', { name })).status).toBe(201);
    const dup = await u1.client.post('/v1/saved-views', { name: name.toUpperCase() });
    expect(dup.status).toBe(409);
    expect(dup.body.errors[0].pointer).toBe('/name');
    expect((await u2.client.post('/v1/saved-views', { name })).status).toBe(201);
    // defaults: empty filters, no columns, default sort
    const minimal = await u1.client.post('/v1/saved-views', { name: unique('Min') });
    expect(minimal.body).toMatchObject({ filters: {}, columns: [], sort: null });
    // validation
    expect((await u1.client.post('/v1/saved-views', { name: '' })).status).toBe(422);
    expect((await u1.client.post('/v1/saved-views', { name: 'x', bogus: 1 })).status).toBe(422);
    expect(
      (await u1.client.post('/v1/saved-views', { name: 'x', resource: 'people' })).status,
    ).toBe(422);
    expect(
      (
        await u1.client.post('/v1/saved-views', {
          name: unique('Big'),
          filters: { q: 'x'.repeat(13_000) },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await u1.client.post('/v1/saved-views', {
          name: unique('Cols'),
          columns: Array(41).fill('c'),
        })
      ).status,
    ).toBe(422);
  });

  it('allows at most 50 views per user and list', async () => {
    const u = await createUser(app, t, 'viewer');
    for (let i = 0; i < 50; i++) {
      const r = await u.client.post('/v1/saved-views', { name: `v-${i}` });
      expect(r.status).toBe(201);
    }
    const over = await u.client.post('/v1/saved-views', { name: 'one too many' });
    expect(over.status).toBe(409);
    expect(over.body.detail).toMatch(/50/);
  });

  it('private views are invisible to others; sharing needs view:share and is owner-only', async () => {
    const owner = await createUser(app, t, 'asset_manager'); // holds view:share
    const peer = await createUser(app, t, 'technician'); // does not
    const viewer = await createUser(app, t, 'viewer');
    const mine = await owner.client.post('/v1/saved-views', body({ name: unique('Team') }));
    expect(mine.status).toBe(201);
    const id = mine.body.id as string;

    expect((await peer.client.get(`/v1/saved-views/${id}`)).status).toBe(404);
    expect((await peer.client.get('/v1/saved-views?scope=shared')).body.data).toEqual([]);
    expect(
      (
        await peer.client.put(
          `/v1/saved-views/${id}/sharing`,
          { shared: true },
          ifMatch(mine.headers.etag),
        )
      ).status,
    ).toBe(403);
    // not the owner: 404 even with the permission
    expect(
      (await a().put(`/v1/saved-views/${id}/sharing`, { shared: true }, ifMatch(mine.headers.etag)))
        .status,
    ).toBe(404);

    const shared = await owner.client.put(
      `/v1/saved-views/${id}/sharing`,
      { shared: true },
      ifMatch(mine.headers.etag),
    );
    expect(shared.status).toBe(200);
    expect(shared.body.is_shared).toBe(true);
    expect((await auditRows(t.tenantId, `entity_id = '${id}'`)).map((r) => r.action)).toEqual([
      'saved_view.created',
      'saved_view.shared',
    ]);

    // everyone in the tenant now sees it, read only
    const seen = await viewer.client.get(`/v1/saved-views/${id}`);
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({ is_shared: true, is_owner: false });
    expect(
      (await viewer.client.get('/v1/saved-views?scope=shared')).body.data.map(
        (v: { id: string }) => v.id,
      ),
    ).toEqual([id]);
    expect((await viewer.client.get('/v1/saved-views?scope=mine')).body.data).toEqual([]);
    expect(
      (await viewer.client.get('/v1/saved-views')).body.data.map((v: { id: string }) => v.id),
    ).toContain(id);
    expect(
      (
        await viewer.client.patch(
          `/v1/saved-views/${id}`,
          { name: 'hijack' },
          ifMatch(shared.headers.etag),
        )
      ).status,
    ).toBe(404);
    expect(
      (await viewer.client.del(`/v1/saved-views/${id}`, undefined, ifMatch(shared.headers.etag)))
        .status,
    ).toBe(404);
    // other tenants never
    expect((await other.admin.get(`/v1/saved-views/${id}`)).status).toBe(404);
    expect((await other.admin.get('/v1/saved-views?scope=shared')).body.data).toEqual([]);

    // two shared views cannot have the same name
    const clash = await a().post('/v1/saved-views', { name: mine.body.name.toUpperCase() });
    expect(clash.status).toBe(201);
    const clashShare = await a().put(
      `/v1/saved-views/${clash.body.id}/sharing`,
      { shared: true },
      ifMatch(clash.headers.etag),
    );
    expect(clashShare.status).toBe(409);

    // the owner can stop sharing; the owner can always delete
    const unshared = await owner.client.put(
      `/v1/saved-views/${id}/sharing`,
      { shared: false },
      ifMatch(shared.headers.etag),
    );
    expect(unshared.body.is_shared).toBe(false);
    expect((await viewer.client.get(`/v1/saved-views/${id}`)).status).toBe(404);
  });

  it('warns about references to things that no longer exist or are archived', async () => {
    const category = (await a().post('/v1/categories', { name: unique('Cat') })).body;
    const status = (await a().get('/v1/status-labels')).body.data[0];
    const location = (await a().post('/v1/locations', { name: unique('Room') })).body;
    const gone = randomUUID();
    const res = await a().post(
      '/v1/saved-views',
      body({
        filters: {
          category_id: category.id,
          status_id: [status.id, gone],
          location_id: location.id,
          q: 'x',
          person_id: randomUUID(),
        },
      }),
    );
    expect(
      res.body.warnings
        .map((w: { field: string; reason: string }) => `${w.field}:${w.reason}`)
        .sort(),
    ).toEqual(['person_id:not-found', 'status_id:not-found']);
    const catRow = await a().get(`/v1/categories/${category.id}`);
    await a().del(`/v1/categories/${category.id}`, undefined, ifMatch(catRow.headers.etag));
    const locRow = await a().get(`/v1/locations/${location.id}`);
    await a().del(`/v1/locations/${location.id}`, undefined, ifMatch(locRow.headers.etag));
    const later = await a().get(`/v1/saved-views/${res.body.id}`);
    expect(
      later.body.warnings
        .map((w: { field: string; reason: string }) => `${w.field}:${w.reason}`)
        .sort(),
    ).toEqual([
      'category_id:archived',
      'location_id:archived',
      'person_id:not-found',
      'status_id:not-found',
    ]);
    // the list carries the warnings too
    const list = await a().get('/v1/saved-views?limit=200');
    expect(list.body.data.find((v: { id: string }) => v.id === res.body.id).warnings).toHaveLength(
      4,
    );
  });

  it('pages in name order', async () => {
    const u = await createUser(app, t, 'viewer');
    for (const n of ['b-view', 'a-view', 'c-view']) {
      await u.client.post('/v1/saved-views', { name: n });
    }
    const p1 = await u.client.get('/v1/saved-views?limit=2');
    expect(p1.body.data.map((v: { name: string }) => v.name)).toEqual(['a-view', 'b-view']);
    const p2 = await u.client.get(`/v1/saved-views?limit=2&cursor=${p1.body.page.next_cursor}`);
    expect(p2.body.data.map((v: { name: string }) => v.name)).toEqual(['c-view']);
    expect((await u.client.get('/v1/saved-views?scope=nope')).status).toBe(400);
    expect((await u.client.get('/v1/saved-views?cursor=garbage')).status).toBe(400);
  });

  it('is for browser sessions: an API key is refused', async () => {
    const key = await a().post('/v1/api-keys', { name: 'k', scopes: ['asset:read'] });
    const res = await a()
      .clone()
      .get('/v1/saved-views', {
        headers: { authorization: `Bearer ${key.body.secret}` },
        cookie: false,
      });
    expect(res.status).toBe(403);
  });
});
