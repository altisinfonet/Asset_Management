import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type App,
  type TenantFixture,
  auditRows,
  contractViolations,
  basics,
  createTenant,
  createUser,
  ifMatch,
  newAsset,
  newLocation,
  newTenancy,
  outboxRows,
  startRegistryApp,
  unique,
  type Basics,
  type Resp,
  historyOf,
} from './support.js';

/**
 * M2-LOC-01 (hierarchy) and M2-LOC-02 (asset location and moves). One tenant, one tree per test.
 */
describe.skipIf(!dbEnabled)(`locations and asset moves (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;
  let b: Basics;
  const a = () => t.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'locs');
    other = await createTenant(app, tenancy, 'locs2');
    b = await basics(t);
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    // every status this file provoked is one the contract documents for that operation
    expect(contractViolations()).toEqual([]);
  });

  /** site > building > room */
  async function tree() {
    const site = await newLocation(a(), { name: unique('Site'), kind: 'site' });
    const building = await newLocation(a(), {
      name: unique('Building'),
      kind: 'building',
      parent_id: site.id,
    });
    const room = await newLocation(a(), {
      name: unique('Room'),
      kind: 'room',
      parent_id: building.id,
    });
    return { site, building, room };
  }

  describe('hierarchy (M2-LOC-01)', () => {
    it('keeps the materialised path: ancestor_ids root..self and depth, and 201 + ETag + Location', async () => {
      const { site, building, room } = await tree();
      expect(site.body).toMatchObject({ parent_id: null, depth: 0, ancestor_ids: [site.id] });
      expect(building.body).toMatchObject({ depth: 1, ancestor_ids: [site.id, building.id] });
      expect(room.body).toMatchObject({
        depth: 2,
        ancestor_ids: [site.id, building.id, room.id],
        asset_count: 0,
        direct_asset_count: 0,
        child_count: 0,
      });
      const res = await a().post('/v1/locations', { name: unique('X'), address: { city: 'Oslo' } });
      expect(res.status).toBe(201);
      expect(res.headers.etag).toMatch(/^W\/"1"$/);
      expect(res.headers.location).toBe(`/v1/locations/${res.body.id}`);
      expect(res.body.address).toMatchObject({ city: 'Oslo' });
    });

    it('a name is unique per parent (case-insensitive), free elsewhere and after archiving', async () => {
      const { site, building } = await tree();
      const name = unique('Lab');
      await newLocation(a(), { name, parent_id: site.id });
      const dup = await a().post('/v1/locations', { name: name.toUpperCase(), parent_id: site.id });
      expect(dup.status).toBe(409);
      expect(dup.body.errors[0]).toMatchObject({ pointer: '/name', code: 'duplicate' });
      // same name under another parent, and a root with that name, are fine
      expect((await a().post('/v1/locations', { name, parent_id: building.id })).status).toBe(201);
      const root = await a().post('/v1/locations', { name: unique('Root') });
      expect((await a().post('/v1/locations', { name: root.body.name })).status).toBe(409);
      // archive frees the name
      expect(
        (await a().del(`/v1/locations/${root.body.id}`, undefined, ifMatch(root.headers.etag)))
          .status,
      ).toBe(204);
      expect((await a().post('/v1/locations', { name: root.body.name })).status).toBe(201);
    });

    it('refuses an unknown, archived or other-tenant parent (422 on /parent_id)', async () => {
      const foreign = await newLocation(other.admin);
      for (const parent_id of [crypto.randomUUID(), foreign.id]) {
        const res = await a().post('/v1/locations', { name: unique('X'), parent_id });
        expect(res.status).toBe(422);
        expect(res.body.errors[0]).toMatchObject({ pointer: '/parent_id', code: 'not-found' });
      }
      const gone = await a().post('/v1/locations', { name: unique('Gone') });
      await a().del(`/v1/locations/${gone.body.id}`, undefined, ifMatch(gone.headers.etag));
      const res = await a().post('/v1/locations', { name: unique('X'), parent_id: gone.body.id });
      expect(res.status).toBe(422);
    });

    it('documents a depth limit of ten levels: the eleventh is refused, a move that would exceed it too', async () => {
      let parent: string | null = null;
      const ids: string[] = [];
      for (let level = 0; level < 10; level++) {
        const res = await a().post('/v1/locations', {
          name: unique(`L${level}`),
          parent_id: parent,
        });
        expect(res.status, `level ${level}: ${res.raw}`).toBe(201);
        expect(res.body.depth).toBe(level);
        parent = res.body.id;
        ids.push(res.body.id);
      }
      const tooDeep = await a().post('/v1/locations', { name: unique('L10'), parent_id: parent });
      expect(tooDeep.status).toBe(422);
      expect(tooDeep.body.errors[0]).toMatchObject({ pointer: '/parent_id', code: 'too-deep' });
      // moving a 3-level subtree under level 8 would reach depth 10: refused; under level 6 it fits
      const { site } = await tree();
      const siteEtag = (await a().get(`/v1/locations/${site.id}`)).headers.etag;
      const refused = await a().patch(
        `/v1/locations/${site.id}`,
        { parent_id: ids[8] },
        ifMatch(siteEtag),
      );
      expect(refused.status).toBe(422);
      expect(refused.body.errors[0].code).toBe('too-deep');
      const ok = await a().patch(
        `/v1/locations/${site.id}`,
        { parent_id: ids[6] },
        ifMatch(siteEtag),
      );
      expect(ok.status, ok.raw).toBe(200);
      expect(ok.body.depth).toBe(7);
    });

    it('moving a location rewrites the path and depth of its whole subtree in one transaction', async () => {
      const { site, building, room } = await tree();
      const other2 = await newLocation(a(), { name: unique('Site2'), kind: 'site' });
      const bEtag = (await a().get(`/v1/locations/${building.id}`)).headers.etag;
      const moved = await a().patch(
        `/v1/locations/${building.id}`,
        { parent_id: other2.id },
        ifMatch(bEtag),
      );
      expect(moved.status, moved.raw).toBe(200);
      expect(moved.body.ancestor_ids).toEqual([other2.id, building.id]);
      const r = await a().get(`/v1/locations/${room.id}`);
      expect(r.body).toMatchObject({ depth: 2, ancestor_ids: [other2.id, building.id, room.id] });
      const under = await a().get(`/v1/locations?descendants_of=${other2.id}`);
      expect(under.body.data.map((l: { id: string }) => l.id).sort()).toEqual(
        [building.id, room.id].sort(),
      );
      expect((await a().get(`/v1/locations?descendants_of=${site.id}`)).body.data).toEqual([]);
      // a move to the root
      const rootEtag = (await a().get(`/v1/locations/${building.id}`)).headers.etag;
      const root = await a().patch(
        `/v1/locations/${building.id}`,
        { parent_id: null },
        ifMatch(rootEtag),
      );
      expect(root.body).toMatchObject({ parent_id: null, depth: 0 });
      expect((await a().get(`/v1/locations/${room.id}`)).body.depth).toBe(1);
      const audit = await auditRows(
        t.tenantId,
        `action = 'location.moved' and entity_id = '${building.id}'`,
      );
      expect(audit.length).toBeGreaterThanOrEqual(2);
      expect(audit[0]!.diff?.meta).toMatchObject({ moved_descendants: 1 });
    });

    it('rejects cycles: under itself, under a descendant; concurrent opposite moves cannot form one', async () => {
      const { site, building, room } = await tree();
      const etag = async (id: string) => (await a().get(`/v1/locations/${id}`)).headers.etag;
      for (const parent_id of [site.id, room.id, building.id]) {
        const res = await a().patch(
          `/v1/locations/${site.id}`,
          { parent_id },
          ifMatch(await etag(site.id)),
        );
        expect(res.status, `site under ${parent_id}`).toBe(422);
        expect(res.body.errors[0]).toMatchObject({ pointer: '/parent_id', code: 'cycle' });
      }
      // two siblings moved under each other at the same time: exactly one wins, no cycle remains
      const x = await newLocation(a());
      const y = await newLocation(a());
      const [r1, r2] = await Promise.all([
        a().patch(`/v1/locations/${x.id}`, { parent_id: y.id }, ifMatch(await etag(x.id))),
        a().patch(`/v1/locations/${y.id}`, { parent_id: x.id }, ifMatch(await etag(y.id))),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 422]);
      const [lx, ly] = [
        (await a().get(`/v1/locations/${x.id}`)).body,
        (await a().get(`/v1/locations/${y.id}`)).body,
      ];
      expect(Math.max(lx.depth, ly.depth)).toBe(1);
      expect(lx.ancestor_ids.length + ly.ancestor_ids.length).toBe(3);
    });

    it('counts assets per node including descendants, and archive is refused with counts', async () => {
      const { site, building, room } = await tree();
      const asset = await newAsset(a(), b.categoryId, { location_id: room.id });
      await newAsset(a(), b.categoryId, { location_id: building.id });
      const roomRow = (await a().get(`/v1/locations/${room.id}`)).body;
      expect(roomRow).toMatchObject({ asset_count: 1, direct_asset_count: 1, child_count: 0 });
      const siteRow = (await a().get(`/v1/locations/${site.id}`)).body;
      expect(siteRow).toMatchObject({ asset_count: 2, direct_asset_count: 0, child_count: 1 });
      const list = await a().get(`/v1/locations?descendants_of=${site.id}&sort=depth`);
      expect(list.body.data.map((l: { asset_count: number }) => l.asset_count)).toEqual([2, 1]);

      const siteEtag = (await a().get(`/v1/locations/${site.id}`)).headers.etag;
      const refused = await a().del(`/v1/locations/${site.id}`, undefined, ifMatch(siteEtag));
      expect(refused.status).toBe(409);
      expect(refused.body.usage).toMatchObject({ children: 1, assets: 0 });
      const roomEtag = (await a().get(`/v1/locations/${room.id}`)).headers.etag;
      const withAssets = await a().del(`/v1/locations/${room.id}`, undefined, ifMatch(roomEtag));
      expect(withAssets.status).toBe(409);
      expect(withAssets.body.usage).toMatchObject({
        children: 0,
        assets: 1,
        people: 0,
        open_assignments: 0,
      });
      // a person living there blocks it too
      const emptyRoom = await newLocation(a(), { parent_id: site.id });
      await a().post('/v1/people', { display_name: unique('P'), location_id: emptyRoom.id });
      const withPeople = await a().del(`/v1/locations/${emptyRoom.id}`, undefined, ifMatch('*'));
      expect(withPeople.body.usage).toMatchObject({ people: 1 });
      // moving the asset away frees the room
      await a().post(`/v1/assets/${asset.id}/move`, { location_id: building.id });
      const free = await a().del(
        `/v1/locations/${room.id}`,
        undefined,
        ifMatch((await a().get(`/v1/locations/${room.id}`)).headers.etag),
      );
      expect(free.status).toBe(204);
      expect((await a().get(`/v1/locations/${room.id}`)).status).toBe(200); // archived rows stay readable
      expect((await a().get(`/v1/locations/${room.id}`)).body.archived_at).toBeTruthy();
    });

    it('lists with filters, search, sort and cursors; ETag and If-Match rules apply', async () => {
      const marker = unique('Zq');
      const parent = await newLocation(a(), {
        name: `${marker} HQ`,
        kind: 'site',
        code: `${marker}-HQ`,
      });
      for (let i = 0; i < 5; i++) {
        await newLocation(a(), { name: `${marker} room ${i}`, kind: 'room', parent_id: parent.id });
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Resp = await a().get(
          `/v1/locations?q=${marker}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        );
        seen.push(...page.body.data.map((l: { id: string }) => l.id));
        cursor = page.body.page.next_cursor;
      } while (cursor);
      expect(seen).toHaveLength(6);
      expect(new Set(seen).size).toBe(6);
      expect(
        (await a().get(`/v1/locations?q=${marker}&kind=room&include_total=true`)).body.page.total,
      ).toBe(5);
      expect((await a().get(`/v1/locations?parent_id=${parent.id}`)).body.data).toHaveLength(5);
      expect((await a().get(`/v1/locations?q=${marker}&root=true`)).body.data).toHaveLength(1);
      expect((await a().get(`/v1/locations?q=${marker}-hq`)).body.data).toHaveLength(1); // by code
      expect((await a().get('/v1/locations?kind=castle')).status).toBe(400);
      expect((await a().get('/v1/locations?cursor=nope')).body.code).toBe('invalid-cursor');

      const got = await a().get(`/v1/locations/${parent.id}`);
      expect(got.headers.etag).toBe('W/"1"');
      expect((await a().patch(`/v1/locations/${parent.id}`, { notes: 'x' })).status).toBe(428);
      expect(
        (await a().patch(`/v1/locations/${parent.id}`, { notes: 'x' }, ifMatch('W/"9"'))).status,
      ).toBe(412);
      const ok = await a().patch(
        `/v1/locations/${parent.id}`,
        { notes: 'x', latitude: 59.9, longitude: 10.7 },
        ifMatch(got.headers.etag),
      );
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ notes: 'x', latitude: 59.9, longitude: 10.7 });
      expect(ok.headers.etag).toBe('W/"2"');
      expect(
        (await a().patch(`/v1/locations/${parent.id}`, { latitude: 99 }, ifMatch(ok.headers.etag)))
          .status,
      ).toBe(422);
      expect(
        (await a().patch(`/v1/locations/${parent.id}`, { name: '' }, ifMatch(ok.headers.etag)))
          .status,
      ).toBe(422);
    });

    it('writes audit rows and outbox events for every change; only location:manage may write', async () => {
      const loc = await newLocation(a());
      const etag = (await a().get(`/v1/locations/${loc.id}`)).headers.etag;
      await a().patch(`/v1/locations/${loc.id}`, { notes: 'n' }, ifMatch(etag));
      await a().del(
        `/v1/locations/${loc.id}`,
        undefined,
        ifMatch((await a().get(`/v1/locations/${loc.id}`)).headers.etag),
      );
      const audit = await auditRows(
        t.tenantId,
        `entity_type = 'location' and entity_id = '${loc.id}'`,
      );
      expect(audit.map((r) => r.action)).toEqual([
        'location.created',
        'location.updated',
        'location.archived',
      ]);
      const events = await outboxRows(t.tenantId, `aggregate_id = '${loc.id}'`);
      expect(events.map((e) => e.event_type)).toEqual([
        'location.created',
        'location.updated',
        'location.archived',
      ]);

      const viewer = await createUser(app, t, 'viewer');
      const tech = await createUser(app, t, 'technician');
      expect((await viewer.client.get('/v1/locations')).status).toBe(200);
      for (const c of [viewer.client, tech.client]) {
        expect((await c.post('/v1/locations', { name: unique('X') })).status).toBe(403);
      }
    });
  });

  /**
   * Founder report 2026-11-24 ("location edit for a site: an error at edit time, none later"). Root
   * cause: an out-of-limit address value (a country name instead of its two-letter code) is a 422
   * on `/address/country`; the web dialog could not place that pointer and only said "the request
   * failed validation". The API now says exactly what the country must be, and the rules of an edit
   * are pinned here: ED-16 (no rule ties `kind` to the parent or to children; a site may have a
   * parent; `kind` is freely editable).
   */
  describe('editing a location (founder report 2026-11-24, ED-16)', () => {
    const patch = async (id: string, body: Record<string, unknown>, etag?: string) => {
      const current = etag ?? (await a().get(`/v1/locations/${id}`)).headers.etag;
      return a().patch(`/v1/locations/${id}`, body, ifMatch(current));
    };

    it('address.country must be a two-letter code and is stored upper-case; other limits name their field', async () => {
      const site = await newLocation(a(), { name: unique('Site'), kind: 'site' });
      for (const country of ['Norway', 'N', '1A', '  ', 'NOR']) {
        const res = await patch(site.id, { address: { country } });
        expect(res.status, country).toBe(422);
        expect(res.body.errors[0], country).toMatchObject({ pointer: '/address/country' });
      }
      const ok = await patch(site.id, {
        address: { line1: '1 Main', city: 'Oslo', country: 'no' },
      });
      expect(ok.status).toBe(200);
      expect(ok.body.address).toMatchObject({ city: 'Oslo', country: 'NO' });
      // null clears it; a create takes the same rule
      expect((await patch(site.id, { address: { country: null } })).status).toBe(200);
      expect(
        (await a().post('/v1/locations', { name: unique('Bad'), address: { country: 'Norway' } }))
          .status,
      ).toBe(422);
      for (const [field, max] of [
        ['line1', 200],
        ['line2', 200],
        ['city', 100],
        ['region', 100],
        ['postal_code', 40],
      ] as const) {
        const res = await patch(site.id, { address: { [field]: 'x'.repeat(max + 1) } });
        expect(res.status, field).toBe(422);
        expect(res.body.errors[0].pointer, field).toBe(`/address/${field}`);
      }
    });

    it('kind is freely editable, with children, assets and a parent: nothing else about the location changes', async () => {
      const { site, building, room } = await tree();
      await a().post('/v1/assets', { category_id: b.categoryId, location_id: building.id });
      await a().post('/v1/assets', { category_id: b.categoryId, location_id: room.id });
      for (const [loc, kind] of [
        [building.id, 'site'], // building -> site (it keeps its parent: a site may have a parent)
        [building.id, 'floor'],
        [site.id, 'room'], // site -> room (a root with a subtree)
        [site.id, 'site'],
        [room.id, 'site'], // room -> site, with assets and a parent
        [room.id, 'storage'],
        [building.id, 'building'],
      ] as const) {
        const res = await patch(loc, { kind });
        expect(res.status, `${loc} -> ${kind}`).toBe(200);
        expect(res.body.kind).toBe(kind);
      }
      const after = await a().get(`/v1/locations/${building.id}`);
      expect(after.body).toMatchObject({
        parent_id: site.id,
        depth: 1,
        child_count: 1,
        asset_count: 2,
        direct_asset_count: 1,
      });
      // a change of kind alone is audited as an update, not a move
      const audit = await auditRows(
        t.tenantId,
        `entity_type = 'location' and entity_id = '${building.id}'`,
      );
      expect(audit.map((r) => r.action)).not.toContain('location.moved');
    });

    it('a site may be moved under another site or to the top level; a location under its own subtree is a 422, never a 500', async () => {
      const one = await tree();
      const two = await tree();
      expect((await patch(one.site.id, { parent_id: two.site.id })).status).toBe(200);
      expect((await patch(one.site.id, { parent_id: null })).status).toBe(200);
      for (const target of [one.room.id, one.building.id, one.site.id]) {
        const res = await patch(one.site.id, { parent_id: target });
        expect(res.status, target).toBe(422);
        expect(res.body.errors[0]).toMatchObject({ pointer: '/parent_id', code: 'cycle' });
      }
      // nothing moved
      expect((await a().get(`/v1/locations/${one.site.id}`)).body.parent_id).toBeNull();
      const gone = await newLocation(a());
      await a().del(
        `/v1/locations/${gone.id}`,
        undefined,
        ifMatch((await a().get(`/v1/locations/${gone.id}`)).headers.etag),
      );
      const archivedParent = await patch(one.building.id, { parent_id: gone.id });
      expect(archivedParent.status).toBe(422);
      expect(archivedParent.body.errors[0]).toMatchObject({ pointer: '/parent_id' });
    });

    it('a duplicate name under the same parent is a 409 on /name (also case-insensitively, also when moving)', async () => {
      const root = await newLocation(a(), { name: unique('R'), kind: 'site' });
      const first = await newLocation(a(), { name: unique('Twin'), parent_id: root.id });
      const second = await newLocation(a(), { name: unique('Other'), parent_id: root.id });
      for (const name of [first.body.name, first.body.name.toUpperCase()]) {
        const res = await patch(second.id, { name });
        expect(res.status).toBe(409);
        expect(res.body.errors[0]).toMatchObject({ pointer: '/name', code: 'duplicate' });
      }
      // the same name elsewhere is fine; moving into a parent that has it is the same 409
      const elsewhere = await newLocation(a(), { name: first.body.name });
      const moved = await patch(elsewhere.id, { parent_id: root.id });
      expect(moved.status).toBe(409);
      expect(moved.body.errors[0].pointer).toBe('/name');
      // renaming to its own name (different case) is not a conflict with itself
      expect((await patch(first.id, { name: first.body.name.toUpperCase() })).status).toBe(200);
    });

    it('If-Match: missing 428, stale 412 (also after another editor), fresh 200; the ETag of a create is usable at once; moving assets in does not stale it', async () => {
      const created = await a().post('/v1/locations', { name: unique('Fresh'), kind: 'site' });
      expect(created.status).toBe(201);
      const asset = await newAsset(a(), b.categoryId, { location_id: created.body.id });
      expect(asset.id).toBeTruthy();
      expect((await a().patch(`/v1/locations/${created.body.id}`, { notes: 'n' })).status).toBe(
        428,
      );
      // the ETag of the 201 still describes the location after an asset was put in it
      const first = await patch(created.body.id, { code: 'F-1' }, String(created.headers.etag));
      expect(first.status).toBe(200);
      // someone else saved in between: the older ETag is refused with 412, the new one works
      const stale = await patch(created.body.id, { code: 'F-2' }, String(created.headers.etag));
      expect(stale.status).toBe(412);
      expect(stale.body.code).toBe('precondition-failed');
      expect(
        (await patch(created.body.id, { code: 'F-2' }, String(first.headers.etag))).status,
      ).toBe(200);
    });

    it('an archived location cannot be edited (404), and a location of another tenant is a 404 too', async () => {
      const loc = await newLocation(a());
      const etag = (await a().get(`/v1/locations/${loc.id}`)).headers.etag;
      expect((await a().del(`/v1/locations/${loc.id}`, undefined, ifMatch(etag))).status).toBe(204);
      const res = await patch(loc.id, { notes: 'x' }, String(etag));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not-found');
      const foreign = await newLocation(other.admin);
      expect((await patch(foreign.id, { notes: 'x' }, 'W/"1"')).status).toBe(404);
    });

    it('every role: asset manager and administrator edit; technician, auditor and viewer get a 403', async () => {
      const loc = await newLocation(a(), { name: unique('Roles'), kind: 'site' });
      const manager = await createUser(app, t, 'asset_manager');
      const etag = String((await a().get(`/v1/locations/${loc.id}`)).headers.etag);
      const edited = await manager.client.patch(
        `/v1/locations/${loc.id}`,
        { kind: 'building' },
        ifMatch(etag),
      );
      expect(edited.status).toBe(200);
      for (const role of ['technician', 'auditor', 'viewer']) {
        const user = await createUser(app, t, role);
        const res = await user.client.patch(
          `/v1/locations/${loc.id}`,
          { kind: 'room' },
          ifMatch(String(edited.headers.etag)),
        );
        expect(res.status, role).toBe(403);
        expect(res.body.code).toBe('forbidden');
      }
    });
  });

  describe('asset location and moves (M2-LOC-02)', () => {
    it('location_id is writable on create and update, validated, and recorded in the history', async () => {
      const { site, building } = await tree();
      const asset = await newAsset(a(), b.categoryId, { location_id: site.id });
      expect(asset.body.location_id).toBe(site.id);
      const bad = await a().post('/v1/assets', {
        category_id: b.categoryId,
        location_id: crypto.randomUUID(),
      });
      expect(bad.status).toBe(422);
      expect(bad.body.errors[0]).toMatchObject({ pointer: '/location_id', code: 'not-found' });
      const foreign = await newLocation(other.admin);
      expect(
        (await a().post('/v1/assets', { category_id: b.categoryId, location_id: foreign.id }))
          .status,
      ).toBe(422);

      const patched = await a().patch(
        `/v1/assets/${asset.id}`,
        { location_id: building.id },
        ifMatch(asset.etag),
      );
      expect(patched.status, patched.raw).toBe(200);
      expect(patched.body.location_id).toBe(building.id);
      const cleared = await a().patch(
        `/v1/assets/${asset.id}`,
        { location_id: null },
        ifMatch(patched.headers.etag),
      );
      expect(cleared.body.location_id).toBeNull();

      const history = await historyOf(a(), asset.id);
      expect(history.map((h) => h.event_type)).toEqual([
        'created',
        'location_changed',
        'location_changed',
      ]);
      expect(history[1]!.payload).toMatchObject({ from: site.id, to: building.id });
      expect(history[2]!.payload).toMatchObject({ from: building.id, to: null });
    });

    it('POST /assets/{id}/move changes the location with a note: history, audit, outbox; ETag and If-Match', async () => {
      const { site, building } = await tree();
      const asset = await newAsset(a(), b.categoryId, { location_id: site.id });
      const stale = await a().post(
        `/v1/assets/${asset.id}/move`,
        { location_id: building.id },
        ifMatch('W/"9"'),
      );
      expect(stale.status).toBe(412);
      const moved = await a().post(
        `/v1/assets/${asset.id}/move`,
        { location_id: building.id, note: 'new rack' },
        ifMatch(asset.etag),
      );
      expect(moved.status, moved.raw).toBe(200);
      expect(moved.body.location_id).toBe(building.id);
      expect(moved.headers.etag).toBe('W/"2"');
      // moving to where it already is changes nothing (no new version, no history)
      const same = await a().post(`/v1/assets/${asset.id}/move`, { location_id: building.id });
      expect(same.headers.etag).toBe('W/"2"');
      expect(
        (await historyOf(a(), asset.id)).filter((h) => h.event_type === 'location_changed'),
      ).toHaveLength(1);
      const event = (await historyOf(a(), asset.id)).at(-1)!;
      expect(event).toMatchObject({ event_type: 'location_changed', actor_type: 'user' });
      expect(event.actor).toMatchObject({ display_name: expect.any(String) });
      expect(event.payload).toMatchObject({ from: site.id, to: building.id, note: 'new rack' });
      expect(event.summary).toContain('Moved from');
      const audit = await auditRows(
        t.tenantId,
        `action = 'asset.moved' and entity_id = '${asset.id}'`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.diff).toMatchObject({
        after: { location_id: building.id },
        meta: { note: 'new rack' },
      });
      expect(
        (
          await outboxRows(
            t.tenantId,
            `event_type = 'asset.moved' and aggregate_id = '${asset.id}'`,
          )
        )[0]!.payload,
      ).toMatchObject({ toLocationId: building.id });
      // unknown location 422, unknown asset 404, archived asset 409
      expect(
        (await a().post(`/v1/assets/${asset.id}/move`, { location_id: crypto.randomUUID() }))
          .status,
      ).toBe(422);
      expect(
        (await a().post(`/v1/assets/${crypto.randomUUID()}/move`, { location_id: null })).status,
      ).toBe(404);
      await a().del(
        `/v1/assets/${asset.id}`,
        undefined,
        ifMatch((await a().get(`/v1/assets/${asset.id}`)).headers.etag),
      );
      expect((await a().post(`/v1/assets/${asset.id}/move`, { location_id: site.id })).status).toBe(
        409,
      );
      // technicians may move, viewers may not
      const tech = await createUser(app, t, 'technician');
      const viewer = await createUser(app, t, 'viewer');
      const other2 = await newAsset(a(), b.categoryId);
      expect(
        (await tech.client.post(`/v1/assets/${other2.id}/move`, { location_id: site.id })).status,
      ).toBe(200);
      expect(
        (await viewer.client.post(`/v1/assets/${other2.id}/move`, { location_id: site.id })).status,
      ).toBe(403);
    });

    it('bulk move reports one result per id and does not let one failure undo the others', async () => {
      const { site, room } = await tree();
      const x = await newAsset(a(), b.categoryId);
      const y = await newAsset(a(), b.categoryId);
      await a().del(`/v1/assets/${y.id}`, undefined, ifMatch(y.etag)); // archived: that item fails
      const res = await a().post('/v1/assets/bulk-move', {
        ids: [x.id, y.id, crypto.randomUUID()],
        location_id: room.id,
        note: 'cart to the room',
      });
      expect(res.status, res.raw).toBe(200);
      expect(res.body.summary).toEqual({ total: 3, succeeded: 1, failed: 2 });
      expect(res.body.results.map((r: { status: number }) => r.status)).toEqual([200, 409, 404]);
      expect((await a().get(`/v1/assets/${x.id}`)).body.location_id).toBe(room.id);
      expect((await a().get(`/v1/assets/${y.id}`)).body.location_id).toBeNull();
      expect(
        (await a().post('/v1/assets/bulk-move', { ids: [], location_id: site.id })).status,
      ).toBe(422);
      expect(
        (await a().post('/v1/assets/bulk-move', { ids: [x.id], location_id: crypto.randomUUID() }))
          .body.results[0].status,
      ).toBe(422);
      const bulk = await auditRows(t.tenantId, `action = 'asset.bulk_move'`);
      expect(bulk.at(-1)!.diff?.meta).toMatchObject({ operation: 'move', requested: 1 });
    });

    it('lists by location with sub-locations (default) or only the node, expands the location, and filters custody', async () => {
      const { site, building, room } = await tree();
      const inRoom = await newAsset(a(), b.categoryId, { location_id: room.id });
      const inBuilding = await newAsset(a(), b.categoryId, { location_id: building.id });
      const ids = async (q: string) =>
        ((await a().get(`/v1/assets?${q}`)).body.data as Array<{ id: string }>)
          .map((x) => x.id)
          .sort();
      expect(await ids(`location_id=${site.id}`)).toEqual([inRoom.id, inBuilding.id].sort());
      expect(await ids(`location_id=${site.id}&include_sublocations=true`)).toEqual(
        [inRoom.id, inBuilding.id].sort(),
      );
      expect(await ids(`location_id=${site.id}&include_sublocations=false`)).toEqual([]);
      expect(await ids(`location_id=${building.id}&include_sublocations=false`)).toEqual([
        inBuilding.id,
      ]);
      expect(await ids(`location_id=${room.id}`)).toEqual([inRoom.id]);
      expect(
        (await a().get(`/v1/assets?location_id=${site.id}&include_total=true`)).body.page.total,
      ).toBe(2);
      const expanded = await a().get(`/v1/assets/${inRoom.id}?expand=location`);
      expect(expanded.body.expanded.location).toMatchObject({ id: room.id, depth: 2 });
      expect((await a().get('/v1/assets?include_sublocations=maybe')).status).toBe(400);
      // other tenants never see them
      expect((await other.admin.get(`/v1/assets?location_id=${site.id}`)).body.data).toEqual([]);
    });
  });
});
