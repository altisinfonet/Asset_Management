import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import { ExportRunner } from '../../src/exports/index.js';
import {
  NOTIFICATION_SUBSCRIPTIONS,
  NotificationSubscribers,
} from '../../src/notifications/index.js';
import {
  type ImportHarness,
  type Json,
  type TenantFixture,
  allRows,
  analyzed,
  basics,
  commit,
  contractViolations,
  createTenant,
  dryRun,
  ifMatch,
  key,
  mappingOf,
  newAsset,
  newPerson,
  newTenancy,
  ownerTenantSql,
  patchImport,
  startImportApp,
  unique,
} from '../importer/support.js';
import { createScopedUser } from './support.js';

type Scoped = Awaited<ReturnType<typeof createScopedUser>>;

/**
 * M2-LOC-03 location scoping (ED-26), surface by surface. One organisation with two sites: "In"
 * (with a room below it) and "Out". A technician and a location administrator are limited to "In".
 * Every surface is checked both ways: inside the scope it works as for anybody, outside it the record
 * behaves exactly like a record that does not exist (404 on its path, absent from lists, 422
 * `not-found` when named as a target). Org-wide users see everything, as before.
 */
describe.skipIf(!dbEnabled)(`location scoping of role assignments (${mode})`, () => {
  const tenancy = newTenancy();
  let ih: ImportHarness;
  let t: TenantFixture;
  let tech: Scoped;
  let locAdmin: Scoped;
  let manager: Scoped;
  const admin = () => t.admin;
  const S = () => tech.client;
  const LA = () => locAdmin.client;

  // fixtures
  let categoryId: string;
  let accCategoryId: string;
  let conCategoryId: string;
  let siteIn: string;
  let roomIn: string;
  let siteOut: string;
  const marker = unique('scope').replace(/-/g, '');
  const f: Record<string, string> = {};

  beforeAll(async () => {
    ih = await startImportApp();
    t = await createTenant(ih.h.app, tenancy, 'scope');
    categoryId = (await basics(t)).categoryId;
    accCategoryId = (
      await admin().post('/v1/categories', { name: unique('acc'), kind: 'accessory' })
    ).body.id;
    conCategoryId = (
      await admin().post('/v1/categories', { name: unique('con'), kind: 'consumable' })
    ).body.id;
    siteIn = (await admin().post('/v1/locations', { name: `${marker} In`, kind: 'site' })).body.id;
    roomIn = (
      await admin().post('/v1/locations', {
        name: `${marker} Room`,
        kind: 'room',
        parent_id: siteIn,
      })
    ).body.id;
    siteOut = (await admin().post('/v1/locations', { name: `${marker} Out`, kind: 'site' })).body
      .id;

    f.assetIn = (
      await newAsset(admin(), categoryId, {
        name: `${marker} in`,
        serial: `${marker}-in`,
        location_id: roomIn,
      })
    ).id;
    f.assetOut = (
      await newAsset(admin(), categoryId, {
        name: `${marker} out`,
        serial: `${marker}-out`,
        location_id: siteOut,
      })
    ).id;
    f.assetNone = (await newAsset(admin(), categoryId, { name: `${marker} nowhere` })).id;
    f.personIn = (
      await newPerson(admin(), { display_name: `${marker} kid in`, location_id: siteIn })
    ).id;
    f.personOut = (
      await newPerson(admin(), {
        display_name: `${marker} kid out`,
        email: `${marker}-out@scope.example`,
        location_id: siteOut,
      })
    ).id;
    f.personNone = (await newPerson(admin(), { display_name: `${marker} kid nowhere` })).id;
    f.accIn = (
      await admin().post('/v1/accessories', {
        category_id: accCategoryId,
        name: `${marker} mouse in`,
        qty_total: 5,
        location_id: roomIn,
      })
    ).body.id;
    f.accOut = (
      await admin().post('/v1/accessories', {
        category_id: accCategoryId,
        name: `${marker} mouse out`,
        qty_total: 5,
        location_id: siteOut,
      })
    ).body.id;
    f.conIn = (
      await admin().post('/v1/consumables', {
        category_id: conCategoryId,
        name: `${marker} toner in`,
        initial_qty: 4,
        min_qty: 3,
        location_id: siteIn,
      })
    ).body.id;
    f.conOut = (
      await admin().post('/v1/consumables', {
        category_id: conCategoryId,
        name: `${marker} toner out`,
        initial_qty: 4,
        min_qty: 3,
        location_id: siteOut,
      })
    ).body.id;
    const repairOut = await admin().post('/v1/repairs', {
      asset_id: f.assetOut,
      title: `${marker} repair out`,
    });
    expect(repairOut.status, repairOut.raw).toBe(201);
    f.repairOut = repairOut.body.id;
    f.poolIn = (
      await admin().post('/v1/loaner-pools', {
        name: `${marker} pool in`,
        home_location_id: siteIn,
      })
    ).body.id;
    f.poolOut = (
      await admin().post('/v1/loaner-pools', {
        name: `${marker} pool out`,
        home_location_id: siteOut,
      })
    ).body.id;
    f.loanerIn = (
      await newAsset(admin(), categoryId, { name: `${marker} loaner in`, location_id: siteIn })
    ).id;
    f.loanerOut = (
      await newAsset(admin(), categoryId, { name: `${marker} loaner out`, location_id: siteOut })
    ).id;
    await admin().post(`/v1/loaner-pools/${f.poolIn}/members`, { asset_id: f.loanerIn });
    await admin().post(`/v1/loaner-pools/${f.poolOut}/members`, { asset_id: f.loanerOut });
    const loanOut = await admin().post(
      `/v1/loaner-pools/${f.poolOut}/checkout`,
      { person_id: f.personOut, asset_id: f.loanerOut },
      key(),
    );
    expect(loanOut.status, loanOut.raw).toBe(201);
    f.loanOut = loanOut.body.assignment.id;
    const photo = await admin().post('/v1/attachments', {
      entity_type: 'asset',
      entity_id: f.assetOut,
      filename: `${marker}-out.png`,
      content_type: 'image/png',
      size_bytes: 50,
    });
    f.attachmentOut = photo.body.attachment.id;

    tech = await createScopedUser(ih.h.app, t, 'technician', [siteIn]);
    locAdmin = await createScopedUser(ih.h.app, t, 'tenant_admin', [siteIn], 'locadmin');
    manager = await createScopedUser(ih.h.app, t, 'asset_manager', [siteIn], 'manager');
  });
  afterAll(async () => {
    await ih.h.app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const ids = (res: { body: Json }) => (res.body.data as Json[]).map((r) => r.id as string);

  // ------------------------------------------------------------------------------ assignment

  it('an administrator scopes a role assignment to a location; bad locations are refused', async () => {
    const user = await admin().get(`/v1/users/${tech.id}`);
    expect(user.body.role_assignments).toEqual([
      expect.objectContaining({ scope_type: 'location', location_id: siteIn, company_id: null }),
    ]);
    const unknown = await admin().post('/v1/users', {
      email: `${unique('x')}@scope.example`,
      display_name: 'X',
      send_invite: false,
      status: 'active',
      role_assignments: [
        { role_id: t.roles.viewer, scope_type: 'location', location_id: randomUUID() },
      ],
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.errors[0]).toMatchObject({
      pointer: '/role_assignments/0/location_id',
      code: 'not-found',
    });
    const missing = await admin().post('/v1/users', {
      email: `${unique('x')}@scope.example`,
      display_name: 'X',
      send_invite: false,
      status: 'active',
      role_assignments: [{ role_id: t.roles.viewer, scope_type: 'location' }],
    });
    expect(missing.status).toBe(422);
  });

  it('GET /auth/me says what the principal is scoped to (null for org-wide)', async () => {
    const me = await S().get('/v1/auth/me');
    expect(me.body.location_scope).toEqual({
      locations: [{ id: siteIn, name: `${marker} In`, path: `${marker} In` }],
    });
    expect(me.body.permissions).not.toContain('user:read');
    expect((await admin().get('/v1/auth/me')).body.location_scope).toBeNull();
  });

  it('a scoped administrator is a location administrator: org-only routes are 403', async () => {
    for (const url of ['/v1/users', '/v1/roles', '/v1/api-keys', '/v1/notification-rules']) {
      expect((await LA().get(url)).status, url).toBe(403);
    }
    expect((await LA().post('/v1/categories', { name: unique('c') })).status).toBe(403);
    // the tenant-wide catalogue stays readable
    expect((await LA().get('/v1/categories')).status).toBe(200);
    expect((await S().get('/v1/status-labels')).status).toBe(200);
  });

  // ---------------------------------------------------------------------------------- assets

  it('assets: only the subtree, never an asset without a location; outside is 404', async () => {
    const list = await S().get('/v1/assets?limit=200&include_total=true');
    expect(ids(list)).toContain(f.assetIn);
    expect(ids(list)).not.toContain(f.assetOut);
    expect(ids(list)).not.toContain(f.assetNone);
    expect(list.body.page.total).toBe(list.body.data.length);
    expect((await admin().get('/v1/assets?limit=200')).body.data.length).toBeGreaterThan(
      list.body.data.length,
    );
    expect((await S().get(`/v1/assets/${f.assetIn}`)).status).toBe(200);
    for (const id of [f.assetOut, f.assetNone]) {
      expect((await S().get(`/v1/assets/${id}`)).status).toBe(404);
      expect((await S().get(`/v1/assets/${id}/history`)).status).toBe(404);
      expect((await S().get(`/v1/assets/${id}/assignments`)).status).toBe(404);
      expect((await S().get(`/v1/assets/${id}/repair-summary`)).status).toBe(404);
      expect((await S().patch(`/v1/assets/${id}`, { name: 'x' }, ifMatch('*'))).status).toBe(404);
    }
    // a filter on a location outside the scope finds nothing, like an unknown location
    expect(ids(await S().get(`/v1/assets?location_id=${siteOut}`))).toEqual([]);
  });

  it('asset writes keep the asset inside the scope', async () => {
    const noLocation = await LA().post('/v1/assets', { category_id: categoryId, name: 'x' });
    expect(noLocation.status).toBe(422);
    expect(noLocation.body.errors).toEqual([
      expect.objectContaining({ pointer: '/location_id', code: 'required' }),
    ]);
    const outside = await LA().post('/v1/assets', {
      category_id: categoryId,
      location_id: siteOut,
    });
    expect(outside.status).toBe(422);
    expect(outside.body.errors[0]).toMatchObject({ pointer: '/location_id', code: 'not-found' });
    const created = await LA().post('/v1/assets', { category_id: categoryId, location_id: roomIn });
    expect(created.status, created.raw).toBe(201);

    const moveOut = await S().post(`/v1/assets/${f.assetIn}/move`, { location_id: siteOut });
    expect(moveOut.status).toBe(422);
    expect(moveOut.body.errors[0]).toMatchObject({ pointer: '/location_id', code: 'not-found' });
    const moveNowhere = await S().post(`/v1/assets/${f.assetIn}/move`, { location_id: null });
    expect(moveNowhere.status).toBe(422);
    expect(moveNowhere.body.errors[0]).toMatchObject({ code: 'required' });
    const cur = await S().get(`/v1/assets/${f.assetIn}`);
    const unset = await S().patch(
      `/v1/assets/${f.assetIn}`,
      { location_id: null },
      ifMatch(cur.headers.etag),
    );
    expect(unset.status).toBe(422);
    const moveIn = await S().post(`/v1/assets/${created.body.id}/move`, { location_id: siteIn });
    expect(moveIn.status, moveIn.raw).toBe(200);
    // the org administrator can still do anything
    expect(
      (await admin().post(`/v1/assets/${f.assetNone}/move`, { location_id: null })).status,
    ).toBe(200);
  });

  it('bulk actions with mixed rows: the rows outside the scope fail as not found, the others succeed', async () => {
    const before = (await admin().get(`/v1/assets/${f.assetOut}`)).headers.etag;
    const res = await S().post('/v1/assets/bulk-update', {
      ids: [f.assetIn, f.assetOut],
      changes: { department_id: null },
    });
    expect(res.status, res.raw).toBe(200);
    expect(res.body.results.map((r: Json) => r.status)).toEqual([200, 404]);
    expect(JSON.stringify(res.body.results[1])).not.toContain(`${marker} out`);
    expect((await admin().get(`/v1/assets/${f.assetOut}`)).headers.etag).toBe(before);
    const move = await S().post('/v1/assets/bulk-move', {
      ids: [f.assetIn, f.assetOut],
      location_id: roomIn,
    });
    expect(move.body.results.map((r: Json) => r.status)).toEqual([200, 404]);
    const archive = await LA().post('/v1/assets/bulk-archive', { ids: [f.assetOut] });
    expect(archive.body.results.map((r: Json) => r.status)).toEqual([404]);
  });

  // --------------------------------------------------------------------------------- custody

  it('a scoped technician checks out only inside the subtree, to people and places inside it', async () => {
    const toOutsider = await S().post(
      `/v1/assets/${f.assetIn}/checkout`,
      { person_id: f.personOut },
      key(),
    );
    expect(toOutsider.status).toBe(422);
    expect(toOutsider.body.errors[0]).toMatchObject({ pointer: '/person_id', code: 'not-found' });
    const toNobodysKid = await S().post(
      `/v1/assets/${f.assetIn}/checkout`,
      { person_id: f.personNone },
      key(),
    );
    expect(toNobodysKid.status).toBe(422);
    const toOutsidePlace = await S().post(
      `/v1/assets/${f.assetIn}/checkout`,
      { location_id: siteOut },
      key(),
    );
    expect(toOutsidePlace.status).toBe(422);
    expect(toOutsidePlace.body.errors[0]).toMatchObject({ pointer: '/location_id' });
    const toOutsideAsset = await S().post(
      `/v1/assets/${f.assetIn}/checkout`,
      { target_asset_id: f.assetOut },
      key(),
    );
    expect(toOutsideAsset.status).toBe(422);
    const outsideAsset = await S().post(
      `/v1/assets/${f.assetOut}/checkout`,
      { person_id: f.personIn },
      key(),
    );
    expect(outsideAsset.status).toBe(404);

    const ok = await S().post(`/v1/assets/${f.assetIn}/checkout`, { person_id: f.personIn }, key());
    expect(ok.status, ok.raw).toBe(201);
    const transferOut = await S().post(
      `/v1/assets/${f.assetIn}/transfer`,
      { to_person_id: f.personOut },
      key(),
    );
    expect(transferOut.status).toBe(422);
    const checkinOut = await S().post(
      `/v1/assets/${f.assetIn}/checkin`,
      { checkin_location_id: siteOut },
      key(),
    );
    expect(checkinOut.status).toBe(422);
    const checkin = await S().post(
      `/v1/assets/${f.assetIn}/checkin`,
      { checkin_location_id: roomIn },
      key(),
    );
    expect(checkin.status, checkin.raw).toBe(200);
    expect((await S().post(`/v1/assets/${f.assetOut}/checkin`, {}, key())).status).toBe(404);
  });

  // ------------------------------------------------------------------------ people, locations

  it('people: home location inside the scope only; writes need such a home location', async () => {
    const list = ids(await S().get('/v1/people?limit=200'));
    expect(list).toContain(f.personIn);
    expect(list).not.toContain(f.personOut);
    expect(list).not.toContain(f.personNone);
    for (const id of [f.personOut, f.personNone]) {
      expect((await S().get(`/v1/people/${id}`)).status).toBe(404);
      expect((await S().get(`/v1/people/${id}/assignments`)).status).toBe(404);
      expect((await S().get(`/v1/people/${id}/history`)).status).toBe(404);
      expect((await S().get(`/v1/people/${id}/stock-movements`)).status).toBe(404);
    }
    const homeless = await LA().post('/v1/people', { display_name: unique('p') });
    expect(homeless.status).toBe(422);
    expect(homeless.body.errors[0]).toMatchObject({ pointer: '/location_id', code: 'required' });
    const away = await LA().post('/v1/people', { display_name: unique('p'), location_id: siteOut });
    expect(away.status).toBe(422);
    expect(
      (await LA().post('/v1/people', { display_name: unique('p'), location_id: roomIn })).status,
    ).toBe(201);
  });

  it('locations: the subtree only; no new top-level location, nothing outside', async () => {
    const list = ids(await S().get('/v1/locations?limit=200'));
    expect(list.sort()).toEqual([siteIn, roomIn].sort());
    expect((await S().get(`/v1/locations/${siteOut}`)).status).toBe(404);
    const top = await LA().post('/v1/locations', { name: unique('top') });
    expect(top.status).toBe(422);
    expect(top.body.errors[0]).toMatchObject({ pointer: '/parent_id', code: 'required' });
    const under = await LA().post('/v1/locations', { name: unique('u'), parent_id: siteOut });
    expect(under.status).toBe(422);
    const child = await LA().post('/v1/locations', { name: unique('c'), parent_id: roomIn });
    expect(child.status, child.raw).toBe(201);
    const room = await LA().get(`/v1/locations/${roomIn}`);
    const escape = await LA().patch(
      `/v1/locations/${roomIn}`,
      { parent_id: siteOut },
      ifMatch(room.headers.etag),
    );
    expect(escape.status).toBe(422);
    expect((await LA().patch(`/v1/locations/${siteOut}`, { name: 'x' }, ifMatch('*'))).status).toBe(
      404,
    );
    expect((await LA().del(`/v1/locations/${siteOut}`, undefined, ifMatch('*'))).status).toBe(404);
  });

  // ------------------------------------------------------------------------------------ stock

  it('accessories and consumables: stock by location inside the scope only', async () => {
    const acc = ids(await S().get('/v1/accessories?limit=200'));
    expect(acc).toContain(f.accIn);
    expect(acc).not.toContain(f.accOut);
    expect((await S().get(`/v1/accessories/${f.accOut}`)).status).toBe(404);
    expect((await S().get(`/v1/accessories/${f.accOut}/assignments`)).status).toBe(404);
    expect(
      (await S().post(`/v1/accessories/${f.accOut}/checkout`, { person_id: f.personIn }, key()))
        .status,
    ).toBe(404);
    const accToOutsider = await S().post(
      `/v1/accessories/${f.accIn}/checkout`,
      { person_id: f.personOut },
      key(),
    );
    expect(accToOutsider.status).toBe(422);
    expect(
      (await S().post(`/v1/accessories/${f.accIn}/checkout`, { person_id: f.personIn }, key()))
        .status,
    ).toBe(201);

    const con = ids(await S().get('/v1/consumables?limit=200'));
    expect(con).toContain(f.conIn);
    expect(con).not.toContain(f.conOut);
    expect((await S().get(`/v1/consumables/${f.conOut}`)).status).toBe(404);
    expect((await S().get(`/v1/consumables/${f.conOut}/movements`)).status).toBe(404);
    expect(
      (
        await S().post(
          `/v1/consumables/${f.conOut}/movements`,
          { qty_delta: -1, reason: 'issue' },
          key(),
        )
      ).status,
    ).toBe(404);
    const created = await manager.client.post('/v1/accessories', {
      category_id: accCategoryId,
      name: unique('a'),
      qty_total: 1,
    });
    expect(created.status).toBe(422);
    expect(created.body.errors[0]).toMatchObject({ pointer: '/location_id', code: 'required' });
  });

  // ---------------------------------------------------------------------------------- repairs

  it('repairs: of assets inside the scope only', async () => {
    const mine = await S().post('/v1/repairs', {
      asset_id: f.assetIn,
      title: `${marker} repair in`,
    });
    expect(mine.status, mine.raw).toBe(201);
    const list = ids(await S().get('/v1/repairs?limit=200'));
    expect(list).toContain(mine.body.id);
    expect(list).not.toContain(f.repairOut);
    expect((await S().get(`/v1/repairs/${f.repairOut}`)).status).toBe(404);
    expect(
      (await S().patch(`/v1/repairs/${f.repairOut}`, { title: 'x' }, ifMatch('*'))).status,
    ).toBe(404);
    const outside = await S().post('/v1/repairs', { asset_id: f.assetOut, title: 'x' });
    expect(outside.status).toBe(422);
    expect(outside.body.errors[0]).toMatchObject({ pointer: '/asset_id' });
  });

  // ---------------------------------------------------------------------------------- loaners

  it('loaner pools, loans and the loaner dashboard count inside the scope only', async () => {
    const pools = ids(await S().get('/v1/loaner-pools?limit=200'));
    expect(pools).toContain(f.poolIn);
    expect(pools).not.toContain(f.poolOut);
    expect((await S().get(`/v1/loaner-pools/${f.poolOut}`)).status).toBe(404);
    expect((await S().get(`/v1/loaner-pools/${f.poolOut}/members`)).status).toBe(404);
    expect(
      (await S().post(`/v1/loaner-pools/${f.poolOut}/checkout`, { person_id: f.personIn }, key()))
        .status,
    ).toBe(404);
    expect((await S().get(`/v1/loans/${f.loanOut}`)).status).toBe(404);
    expect(
      (await S().post(`/v1/loans/${f.loanOut}/extend`, { expected_return: '2099-01-01' })).status,
    ).toBe(404);
    const loans = await S().get('/v1/loans?state=on_loan,due_today,overdue,returned');
    expect(loans.body.data.map((l: Json) => l.id)).not.toContain(f.loanOut);

    const lend = await S().post(
      `/v1/loaner-pools/${f.poolIn}/checkout`,
      { person_id: f.personIn },
      key(),
    );
    expect(lend.status, lend.raw).toBe(201);
    expect(lend.body.asset.id).toBe(f.loanerIn);
    const toOutsider = await S().post(
      `/v1/loaner-pools/${f.poolIn}/checkout`,
      { person_id: f.personOut },
      key(),
    );
    expect(toOutsider.status).toBe(422);

    const dash = await S().get('/v1/loaners/dashboard');
    expect(dash.body.pools.map((p: Json) => p.id)).toEqual([f.poolIn]);
    expect(dash.body.totals).toMatchObject({ pools: 1, members: 1, checked_out: 1 });
    expect(JSON.stringify(dash.body)).not.toContain(f.loanOut);
    const orgDash = await admin().get('/v1/loaners/dashboard');
    expect(orgDash.body.totals.pools).toBeGreaterThanOrEqual(2);
    const poolOut = await LA().post('/v1/loaner-pools', { name: unique('pool') });
    expect(poolOut.status).toBe(422);
    expect(poolOut.body.errors[0]).toMatchObject({
      pointer: '/home_location_id',
      code: 'required',
    });
  });

  // -------------------------------------------------------------- labels, scan, search, files

  it('labels: an asset outside the scope is a missing one; a filter selects inside the scope', async () => {
    const refused = await S().post(
      '/v1/labels/batches',
      { template_key: 'letter-30up-qr', asset_ids: [f.assetIn, f.assetOut] },
      key(),
    );
    expect(refused.status).toBe(422);
    expect(refused.body.errors).toEqual([
      expect.objectContaining({ pointer: '/asset_ids/1', code: 'not-found' }),
    ]);
    const byFilter = await S().post(
      '/v1/labels/batches',
      { template_key: 'letter-30up-qr', filter: { q: marker } },
      key(),
    );
    expect([201, 202], byFilter.raw).toContain(byFilter.status);
    const row = await ownerTenantSql(
      t.tenantId,
      'select asset_ids from app.label_batch where id = $1',
      [byFilter.body.id],
    );
    const printed = row.rows[0]!.asset_ids as string[];
    expect(printed).toContain(f.assetIn);
    expect(printed).not.toContain(f.assetOut);
  });

  it('scan resolve and search: outside the scope is an unknown code / no hit', async () => {
    const outTag = (await admin().get(`/v1/assets/${f.assetOut}`)).body.asset_tag as string;
    const inTag = (await admin().get(`/v1/assets/${f.assetIn}`)).body.asset_tag as string;
    expect((await S().get(`/v1/scan/resolve?code=${encodeURIComponent(outTag)}`)).status).toBe(404);
    expect((await S().get(`/v1/scan/resolve?code=${encodeURIComponent(inTag)}`)).status).toBe(200);
    const accOut = (await admin().get(`/v1/accessories/${f.accOut}`)).body.label_code as string;
    expect((await S().get(`/v1/scan/resolve?code=${accOut}`)).status).toBe(404);

    const hits = await S().get(`/v1/search?q=${marker}&limit=50`);
    const found = hits.body.data.map((h: Json) => h.id as string);
    expect(found).toEqual(expect.arrayContaining([f.assetIn, f.personIn, siteIn]));
    for (const id of [f.assetOut, f.assetNone, f.personOut, f.personNone, siteOut]) {
      expect(found).not.toContain(id);
    }
    const all = (await admin().get(`/v1/search?q=${marker}&limit=50`)).body.data.map(
      (h: Json) => h.id,
    );
    expect(all).toEqual(expect.arrayContaining([f.assetOut, f.personOut, siteOut]));
  });

  it('attachments: the files of a record outside the scope do not exist', async () => {
    expect((await S().get(`/v1/attachments/${f.attachmentOut}`)).status).toBe(404);
    const list = await S().get(`/v1/attachments?entity_type=asset&entity_id=${f.assetOut}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
    const upload = await S().post('/v1/attachments', {
      entity_type: 'asset',
      entity_id: f.assetOut,
      filename: 'x.png',
      content_type: 'image/png',
      size_bytes: 50,
    });
    expect(upload.status).toBe(422);
    expect((await admin().get(`/v1/attachments/${f.attachmentOut}`)).status).toBe(200);
  });

  // ---------------------------------------------------------------------- saved views, counts

  it('saved views only carry filters: applied by a scoped user they show the scope only', async () => {
    const shared = await admin().post('/v1/saved-views', {
      name: `${marker} everything at Out`,
      filters: { location_id: siteOut },
    });
    await admin().put(
      `/v1/saved-views/${shared.body.id}/sharing`,
      { shared: true },
      ifMatch(shared.headers.etag),
    );
    const view = await S().get(`/v1/saved-views/${shared.body.id}`);
    expect(view.status).toBe(200);
    const applied = await S().get(`/v1/assets?location_id=${view.body.filters.location_id}`);
    expect(applied.body.data).toEqual([]);
    const own = await S().post('/v1/saved-views', { name: unique('mine'), filters: { q: marker } });
    expect(own.status).toBe(201);
    expect(ids(await S().get(`/v1/assets?q=${marker}`))).not.toContain(f.assetOut);
  });

  it('dashboard counts (totals, location roll-ups, department counts) are of the scope', async () => {
    const total = (await S().get('/v1/assets?limit=1&include_total=true')).body.page.total;
    const orgTotal = (await admin().get('/v1/assets?limit=1&include_total=true')).body.page.total;
    expect(total).toBeLessThan(orgTotal);
    const siteRow = (await S().get(`/v1/locations/${siteIn}`)).body;
    expect(siteRow.asset_count).toBeGreaterThan(0);
    const dept = await admin().post('/v1/departments', { name: unique('dept') });
    for (const id of [f.assetIn, f.assetOut]) {
      const cur = await admin().get(`/v1/assets/${id}`);
      await admin().patch(
        `/v1/assets/${id}`,
        { department_id: dept.body.id },
        ifMatch(cur.headers.etag),
      );
    }
    expect((await S().get(`/v1/departments/${dept.body.id}`)).body.asset_count).toBe(1);
    expect((await admin().get(`/v1/departments/${dept.body.id}`)).body.asset_count).toBe(2);
  });

  // ------------------------------------------------------------------------ exports, imports

  it('exports: the worker writes only the rows of the requester scope; exports are personal', async () => {
    const runner = ih.h.app.get(ExportRunner, { strict: false });
    const requested = await manager.client.post('/v1/exports', { resource: 'assets' });
    expect(requested.status, requested.raw).toBe(202);
    const job = await ownerTenantSql(
      t.tenantId,
      'select location_scoped, location_scope from app.export_job where id = $1',
      [requested.body.id],
    );
    expect(job.rows[0]).toEqual({ location_scoped: true, location_scope: [siteIn] });
    await ih.runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
      runner.run(
        { tenantId: t.tenantId, exportId: requested.body.id },
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
    const done = (await manager.client.get(`/v1/exports/${requested.body.id}`)).body;
    expect(done.status).toBe('succeeded');
    const key = (
      await ownerTenantSql(t.tenantId, 'select storage_key from app.export_job where id = $1', [
        requested.body.id,
      ])
    ).rows[0]!.storage_key as string;
    const chunks: Buffer[] = [];
    for await (const c of await ih.h.storage.read(key)) chunks.push(Buffer.from(c as Buffer));
    const csv = Buffer.concat(chunks).toString('utf8');
    expect(csv).toContain(`${marker} in`);
    expect(csv).not.toContain(`${marker} out`);
    expect(csv).not.toContain(`${marker} nowhere`);
    // somebody else's export does not exist for them (and theirs not for the admin's list)
    const adminExport = await admin().post('/v1/exports', { resource: 'people' });
    expect((await manager.client.get(`/v1/exports/${adminExport.body.id}`)).status).toBe(404);
  });

  it("imports: rows are checked against the scope; somebody else's import does not exist", async () => {
    const outPath = `${marker} Out`;
    const inPath = `${marker} In > ${marker} Room`;
    const csv = [
      'Serial,Name,Category,Location',
      `${marker}-imp-1,${marker} imported in,${(await admin().get(`/v1/categories/${categoryId}`)).body.name},${inPath}`,
      `${marker}-imp-2,${marker} imported out,${(await admin().get(`/v1/categories/${categoryId}`)).body.name},${outPath}`,
      `${marker}-out,${marker} same serial as outside,${(await admin().get(`/v1/categories/${categoryId}`)).body.name},${inPath}`,
    ].join('\n');
    const job = await analyzed(ih, manager.client, t.tenantId, 'asset', {
      filename: 'scope.csv',
      body: csv,
    });
    const patched = await patchImport(manager.client, job.id, {
      mapping: mappingOf(job, {
        Serial: 'serial',
        Name: 'name',
        Category: 'category',
        Location: 'location',
      }),
      options: {
        on_match: 'update',
        references: { location: 'must_exist', category: 'must_exist' },
      },
    });
    expect(patched.status, patched.raw).toBe(200);
    const dry = await dryRun(ih, manager.client, t.tenantId, job.id);
    expect(dry.state).toBe('dry_run_done');
    const rows = await allRows(manager.client, job.id);
    expect(rows[0]!.outcome).toBe('create');
    // a location outside the scope is a location that does not exist
    expect(rows[1]!.outcome).toBe('error');
    expect(JSON.stringify(rows[1]!.errors)).toMatch(/location/i);
    // the serial of an asset outside the scope is not matched for an update (it is not there for them)
    expect(rows[2]!.outcome).not.toBe('update');
    const done = await commit(ih, manager.client, t.tenantId, job.id, dry.dry_run_digest);
    expect(done.state).toBe('completed');
    const scope = await ownerTenantSql(
      t.tenantId,
      'select location_scoped, location_scope from app.import_job where id = $1',
      [job.id],
    );
    expect(scope.rows[0]).toEqual({ location_scoped: true, location_scope: [siteIn] });
    const imported = await admin().get(`/v1/assets?serial=${marker}-imp-1&expand=location`);
    expect(imported.body.data[0].location_id).toBe(roomIn);
    expect((await admin().get(`/v1/assets?serial=${marker}-imp-2`)).body.data).toEqual([]);
    expect((await admin().get(`/v1/assets/${f.assetOut}`)).body.name).toBe(`${marker} out`);

    const adminImport = await admin().post('/v1/imports', { entity_type: 'asset' });
    expect((await manager.client.get(`/v1/imports/${adminImport.body.id}`)).status).toBe(404);
    expect(ids(await manager.client.get('/v1/imports?limit=200'))).toEqual([job.id]);
    // a scoped principal cannot import departments (department:manage is org-only)
    expect((await manager.client.post('/v1/imports', { entity_type: 'department' })).status).toBe(
      403,
    );
  });

  // ------------------------------------------------------------------------------ notifications

  it('notification recipients: a scoped manager is told about stock in the scope only', async () => {
    const subscribers = ih.h.app.get(NotificationSubscribers, { strict: false });
    for (const id of [f.conIn, f.conOut]) {
      const res = await admin().post(
        `/v1/consumables/${id}/movements`,
        { qty_delta: -2, reason: 'issue' },
        key(),
      );
      expect(res.status, res.raw).toBe(201);
    }
    const events = (
      await ownerTenantSql(
        t.tenantId,
        "select id, event_type, aggregate_type, aggregate_id, payload, created_at from app.outbox_event where event_type = 'consumable.low_stock' order by id",
      )
    ).rows as Json[];
    expect(events.map((e) => e.aggregate_id).sort()).toEqual([f.conIn, f.conOut].sort());
    const sub = NOTIFICATION_SUBSCRIPTIONS.find((s) => s.event === 'consumable.low_stock')!;
    for (const e of events) {
      await ih.runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
        subscribers.handle(
          sub,
          {
            id: e.id,
            tenantId: t.tenantId,
            type: e.event_type,
            aggregateType: e.aggregate_type,
            aggregateId: e.aggregate_id,
            payload: e.payload,
            version: 1,
            createdAt: e.created_at,
            attempts: 0,
          },
          tx,
        ),
      );
    }
    const told = async (c: { get: (u: string) => Promise<{ body: Json }> }) =>
      ((await c.get('/v1/notifications?limit=50')).body.data as Json[])
        .filter((n) => n.type === 'consumable.low_stock')
        .map((n) => n.entity_id);
    expect(await told(manager.client)).toEqual([f.conIn]);
    expect((await told(admin())).sort()).toEqual([f.conIn, f.conOut].sort());
  });
});
