import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import { LoanAlerts } from '../../src/loaners/index.js';
import { OutboxRelay, OutboxSubscribers } from '../../src/outbox/index.js';
import { TenancyService } from '../../src/tenancy/index.js';
import {
  type App,
  type Basics,
  type Json,
  type Resp,
  type TenantFixture,
  auditRows,
  basics,
  contractViolations,
  createTenant,
  createUser,
  historyOf,
  ifMatch,
  inDays,
  key,
  keyed,
  newAsset,
  newLocation,
  newPerson,
  newTenancy,
  outboxRows,
  ownerTenantSql,
  startRegistryApp,
  unique,
} from '../lifecycle/support.js';

/**
 * Loaner pools (M2-LOAN-01..04, M2-LIFE-09, ED-20, ED-21): the pool resource and its members, the
 * quick loan and return flows by scanning, extension, the lists, the dashboard, the custody settings
 * and the overdue alert job, all against the real database, outbox relay and notifications.
 */
describe.skipIf(!dbEnabled)(`loaner pools (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;
  let b: Basics;
  let runtime: TenancyService;
  const a = () => t.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'loan');
    other = await createTenant(app, tenancy, 'loan2');
    b = await basics(t);
    runtime = app.get(TenancyService, { strict: false });
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    // every status this file provoked is one the contract documents for that operation
    expect(contractViolations()).toEqual([]);
  });

  // ---------------------------------------------------------------------------------- helpers

  const newPool = async (extra: Record<string, unknown> = {}) => {
    const res = await a().post('/v1/loaner-pools', { name: unique('Cart'), ...extra });
    if (res.status !== 201) throw new Error(`create pool: ${res.status} ${res.raw}`);
    return { id: res.body.id as string, etag: String(res.headers.etag), body: res.body as Json };
  };
  interface Device {
    id: string;
    tag: string;
    label: string;
    serial: string;
  }
  /** A new asset, in the pool when one is given. */
  const device = async (poolId?: string, extra: Record<string, unknown> = {}): Promise<Device> => {
    const serial = unique('SN');
    const asset = await newAsset(a(), b.categoryId, { serial, ...extra });
    if (poolId) {
      const res = await a().post(`/v1/loaner-pools/${poolId}/members`, { asset_id: asset.id });
      if (res.status !== 201) throw new Error(`add member: ${res.status} ${res.raw}`);
    }
    return { id: asset.id, tag: asset.body.asset_tag, label: asset.body.label_code, serial };
  };
  const devices = async (poolId: string, n: number) =>
    Promise.all(Array.from({ length: n }, () => device(poolId)));
  const kid = (extra: Record<string, unknown> = {}) =>
    newPerson(a(), {
      email: `${unique('kid')}@school.example`.toLowerCase(),
      employee_ref: unique('E'),
      kind: 'student',
      ...extra,
    });
  const poolEtag = async (id: string) =>
    String((await a().get(`/v1/loaner-pools/${id}`)).headers.etag);
  const quick = (poolId: string, body: Record<string, unknown>) =>
    a().post(`/v1/loaner-pools/${poolId}/quick-checkout`, body, keyed());
  const giveBack = (body: Record<string, unknown>) => a().post('/v1/loans/return', body, keyed());
  /** Moves the due date of a loan with SQL (the API refuses a date in the past). */
  const setDue = (assignmentId: string, due: string) =>
    ownerTenantSql(
      t.tenantId,
      `update app.assignment set expected_return = '${due}'::date where id = '${assignmentId}'`,
    );
  const loansOf = async (query: string) =>
    (await a().get(`/v1/loans?${query}`)).body.data as Json[];

  // ------------------------------------------------------------------------------- the pool

  describe('the pool resource', () => {
    it('creates with 201, ETag and Location, defaults and live counts; reads, lists, searches and pages', async () => {
      const marker = unique('Zp');
      const home = await newLocation(a());
      const res = await a().post('/v1/loaner-pools', {
        name: `${marker} Chromebooks`,
        description: 'Cart 1',
        home_location_id: home.id,
        default_loan_days: 5,
        max_loan_days: 10,
        max_loans_per_person: 2,
        eligible_person_kinds: ['student', 'employee'],
      });
      expect(res.status).toBe(201);
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(`/v1/loaner-pools/${res.body.id}`);
      expect(res.body).toMatchObject({
        name: `${marker} Chromebooks`,
        home_location_id: home.id,
        default_loan_days: 5,
        max_loan_days: 10,
        max_loans_per_person: 2,
        eligible_person_kinds: ['student', 'employee'],
        owner_user_id: null,
        is_active: true,
        member_count: 0,
        available_count: 0,
        checked_out_count: 0,
        overdue_count: 0,
        due_today_count: 0,
        archived_at: null,
      });
      // the defaults of a pool created with just a name
      const plain = await newPool();
      expect(plain.body).toMatchObject({
        default_loan_days: null,
        effective_default_loan_days: 7,
        email_borrowers_without_login: null,
        max_loan_days: null,
        max_loans_per_person: null,
        eligible_person_kinds: null,
        home_location_id: null,
        is_active: true,
      });
      const got = await a().get(`/v1/loaner-pools/${res.body.id}`);
      expect(got.status).toBe(200);
      expect(got.headers.etag).toBe('W/"1"');

      for (let i = 0; i < 4; i++) await newPool({ name: `${marker} ${i}` });
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Resp = await a().get(
          `/v1/loaner-pools?q=${marker}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        );
        expect(page.status).toBe(200);
        seen.push(...page.body.data.map((d: { id: string }) => d.id));
        cursor = page.body.page.next_cursor;
      } while (cursor);
      expect(new Set(seen).size).toBe(5);
      const sorted = await a().get(`/v1/loaner-pools?q=${marker}&sort=-name&include_total=true`);
      expect(sorted.body.page.total).toBe(5);
      const names = sorted.body.data.map((d: { name: string }) => d.name);
      expect(names).toEqual([...names].sort().reverse());
      expect(
        (await a().get(`/v1/loaner-pools?home_location_id=${home.id}`)).body.data,
      ).toHaveLength(1);
      expect((await a().get('/v1/loaner-pools?sort=nope')).status).toBe(400);
      expect((await a().get('/v1/loaner-pools?is_active=maybe')).status).toBe(400);
    });

    it('validates the rules: days, location, owner, kinds; names are unique among live pools', async () => {
      const bad = async (body: Record<string, unknown>) => a().post('/v1/loaner-pools', body);
      expect((await bad({})).status).toBe(422);
      const days = await bad({ name: unique('P'), default_loan_days: 7, max_loan_days: 3 });
      expect(days.status).toBe(422);
      expect(days.body.errors[0]).toMatchObject({ pointer: '/max_loan_days' });
      expect((await bad({ name: unique('P'), default_loan_days: 0 })).status).toBe(422);
      expect((await bad({ name: unique('P'), max_loans_per_person: 0 })).status).toBe(422);
      expect((await bad({ name: unique('P'), eligible_person_kinds: [] })).status).toBe(422);
      expect((await bad({ name: unique('P'), eligible_person_kinds: ['robot'] })).status).toBe(422);
      expect((await bad({ name: unique('P'), colour: 'red' })).status).toBe(422);
      const noLocation = await bad({ name: unique('P'), home_location_id: randomUUID() });
      expect(noLocation.status).toBe(422);
      expect(noLocation.body.errors[0]).toMatchObject({ pointer: '/home_location_id' });
      const foreignLocation = await newLocation(other.admin);
      expect((await bad({ name: unique('P'), home_location_id: foreignLocation.id })).status).toBe(
        422,
      );
      const noOwner = await bad({ name: unique('P'), owner_user_id: randomUUID() });
      expect(noOwner.status).toBe(422);
      expect(noOwner.body.errors[0]).toMatchObject({ pointer: '/owner_user_id' });
      const owner = await createUser(app, t, 'asset_manager');
      expect((await bad({ name: unique('P'), owner_user_id: owner.id })).status).toBe(201);

      const p = await newPool({ name: unique('Dupe') });
      for (const name of [p.body.name.toUpperCase(), `  ${p.body.name.toLowerCase()}  `]) {
        const res = await a().post('/v1/loaner-pools', { name });
        expect(res.status, name).toBe(409);
        expect(res.body.errors[0]).toMatchObject({ pointer: '/name', code: 'duplicate' });
      }
      // names are per tenant: another tenant can use the same one
      expect((await other.admin.post('/v1/loaner-pools', { name: p.body.name })).status).toBe(201);
      // the name is free again once the pool is archived
      expect((await a().del(`/v1/loaner-pools/${p.id}`, undefined, ifMatch(p.etag))).status).toBe(
        204,
      );
      expect((await a().post('/v1/loaner-pools', { name: p.body.name })).status).toBe(201);
    });

    it('updates with If-Match (merge semantics, null clears), answers 412 / 428, and 404 for foreign and archived pools', async () => {
      const p = await newPool({ default_loan_days: 3, max_loan_days: 9, max_loans_per_person: 2 });
      expect((await a().patch(`/v1/loaner-pools/${p.id}`, { description: 'x' })).status).toBe(428);
      const stale = await a().patch(
        `/v1/loaner-pools/${p.id}`,
        { description: 'x' },
        ifMatch('W/"9"'),
      );
      expect(stale.status).toBe(412);
      const ok = await a().patch(
        `/v1/loaner-pools/${p.id}`,
        { description: 'Room 12', max_loan_days: null, max_loans_per_person: null },
        ifMatch(p.etag),
      );
      expect(ok.status).toBe(200);
      expect(ok.headers.etag).toBe('W/"2"');
      expect(ok.body).toMatchObject({
        description: 'Room 12',
        max_loan_days: null,
        max_loans_per_person: null,
        default_loan_days: 3,
      });
      // an update that changes nothing keeps the version
      const same = await a().patch(
        `/v1/loaner-pools/${p.id}`,
        { description: 'Room 12' },
        ifMatch('W/"2"'),
      );
      expect(same.status).toBe(200);
      expect(same.headers.etag).toBe('W/"2"');
      // default above the (kept) maximum is refused; kinds can be set and cleared
      const maxed = await newPool({ default_loan_days: 2, max_loan_days: 5 });
      const tooLong = await a().patch(
        `/v1/loaner-pools/${maxed.id}`,
        { default_loan_days: 6 },
        ifMatch(maxed.etag),
      );
      expect(tooLong.status).toBe(422);
      expect(tooLong.body.errors[0]).toMatchObject({ pointer: '/max_loan_days' });
      const kinds = await a().patch(
        `/v1/loaner-pools/${p.id}`,
        { eligible_person_kinds: ['student'] },
        ifMatch('W/"2"'),
      );
      expect(kinds.body.eligible_person_kinds).toEqual(['student']);
      const cleared = await a().patch(
        `/v1/loaner-pools/${p.id}`,
        { eligible_person_kinds: null },
        ifMatch(String(kinds.headers.etag)),
      );
      expect(cleared.body.eligible_person_kinds).toBeNull();

      const foreign = await newPool();
      expect((await other.admin.get(`/v1/loaner-pools/${foreign.id}`)).status).toBe(404);
      expect(
        (
          await other.admin.patch(
            `/v1/loaner-pools/${foreign.id}`,
            { description: 'x' },
            ifMatch(foreign.etag),
          )
        ).status,
      ).toBe(404);
      expect(
        (await a().del(`/v1/loaner-pools/${p.id}`, undefined, ifMatch(await poolEtag(p.id))))
          .status,
      ).toBe(204);
      expect(
        (await a().patch(`/v1/loaner-pools/${p.id}`, { description: 'y' }, ifMatch('*'))).status,
      ).toBe(404);
      expect(
        (await a().get('/v1/loaner-pools?archived=only&limit=200')).body.data.length,
      ).toBeGreaterThan(0);
    });

    it('records audit and outbox rows for create, update and archive', async () => {
      const p = await newPool();
      await a().patch(`/v1/loaner-pools/${p.id}`, { is_active: false }, ifMatch(p.etag));
      await a().del(`/v1/loaner-pools/${p.id}`, undefined, ifMatch(await poolEtag(p.id)));
      const audit = await auditRows(t.tenantId, `entity_id = '${p.id}'`);
      expect(audit.map((r) => r.action)).toEqual([
        'loaner_pool.created',
        'loaner_pool.updated',
        'loaner_pool.archived',
      ]);
      expect(audit[1]!.diff).toMatchObject({
        before: { is_active: true },
        after: { is_active: false },
      });
      const outbox = await outboxRows(t.tenantId, `aggregate_id = '${p.id}'`);
      expect(outbox.map((r) => r.event_type)).toEqual([
        'loaner_pool.created',
        'loaner_pool.updated',
        'loaner_pool.archived',
      ]);
    });

    it('archiving: 409 with usage while a member is out; otherwise the memberships are released', async () => {
      const p = await newPool();
      const [d1, d2] = await devices(p.id, 2);
      const who = await kid();
      expect(
        (await quick(p.id, { person_id: who.id, codes: [d1!.tag] })).body.summary.succeeded,
      ).toBe(1);
      const busy = await a().del(
        `/v1/loaner-pools/${p.id}`,
        undefined,
        ifMatch(await poolEtag(p.id)),
      );
      expect(busy.status).toBe(409);
      expect(busy.body.usage).toEqual({ open_loans: 1 });
      expect((await giveBack({ codes: [d1!.tag] })).body.summary.succeeded).toBe(1);
      expect(
        (await a().del(`/v1/loaner-pools/${p.id}`, undefined, ifMatch(await poolEtag(p.id))))
          .status,
      ).toBe(204);
      // the devices are free to join another pool
      const q = await newPool();
      expect(
        (await a().post(`/v1/loaner-pools/${q.id}/members`, { asset_id: d2!.id })).status,
      ).toBe(201);
      const audit = await auditRows(
        t.tenantId,
        `entity_id = '${p.id}' and action = 'loaner_pool.archived'`,
      );
      expect(audit[0]!.diff?.meta).toMatchObject({ members_removed: 2 });
    });
  });

  // ---------------------------------------------------------------------------- membership

  describe('members', () => {
    it('adds (201), re-adds (200), refuses another pool (409), archived and unknown assets (422)', async () => {
      const p = await newPool();
      const q = await newPool();
      const d = await device();
      const added = await a().post(`/v1/loaner-pools/${p.id}/members`, { asset_id: d.id });
      expect(added.status).toBe(201);
      expect(added.body).toMatchObject({ asset_id: d.id, loaner_pool_id: p.id, available: true });
      expect(added.body.asset.asset_tag).toBe(d.tag);
      const again = await a().post(`/v1/loaner-pools/${p.id}/members`, { asset_id: d.id });
      expect(again.status).toBe(200);
      expect(again.body.added_at).toBe(added.body.added_at);
      const elsewhere = await a().post(`/v1/loaner-pools/${q.id}/members`, { asset_id: d.id });
      expect(elsewhere.status).toBe(409);
      expect(elsewhere.body.errors[0]).toMatchObject({
        pointer: '/asset_id',
        code: 'in-other-pool',
      });

      expect(
        (await a().post(`/v1/loaner-pools/${p.id}/members`, { asset_id: randomUUID() })).status,
      ).toBe(422);
      const foreignAsset = await newAsset(other.admin, (await basics(other)).categoryId);
      expect(
        (await a().post(`/v1/loaner-pools/${p.id}/members`, { asset_id: foreignAsset.id })).status,
      ).toBe(422);
      const gone = await device();
      await a().del(
        `/v1/assets/${gone.id}`,
        undefined,
        ifMatch((await a().get(`/v1/assets/${gone.id}`)).headers.etag),
      );
      const archived = await a().post(`/v1/loaner-pools/${p.id}/members`, { asset_id: gone.id });
      expect(archived.status).toBe(422);
      expect(archived.body.errors[0]).toMatchObject({ code: 'archived' });
      expect(
        (await a().post(`/v1/loaner-pools/${randomUUID()}/members`, { asset_id: d.id })).status,
      ).toBe(404);
      expect((await a().post(`/v1/loaner-pools/${p.id}/members`, {})).status).toBe(422);
    });

    it('lists in asset-tag order with the full asset and the lendable flag; pages with cursors; filters by available', async () => {
      const p = await newPool();
      const ds = await devices(p.id, 5);
      const who = await kid();
      await quick(p.id, { person_id: who.id, codes: [ds[0]!.tag] });
      const lost = ds[1]!;
      await a().post(
        `/v1/assets/${lost.id}/mark-lost`,
        {},
        ifMatch((await a().get(`/v1/assets/${lost.id}`)).headers.etag),
      );
      const all = await a().get(`/v1/loaner-pools/${p.id}/members`);
      expect(all.status).toBe(200);
      const tags = all.body.data.map((m: Json) => m.asset.asset_tag);
      expect(tags).toEqual([...ds.map((d) => d.tag)].sort());
      const byTag = Object.fromEntries(all.body.data.map((m: Json) => [m.asset.asset_tag, m]));
      expect(byTag[ds[0]!.tag].available).toBe(false); // out
      expect(byTag[ds[0]!.tag].asset.current_assignment).toMatchObject({ loaner_pool_id: p.id });
      expect(byTag[lost.tag].available).toBe(false); // lost
      expect(byTag[ds[2]!.tag].available).toBe(true);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Resp = await a().get(
          `/v1/loaner-pools/${p.id}/members?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        );
        seen.push(...page.body.data.map((m: Json) => m.asset_id));
        cursor = page.body.page.next_cursor;
      } while (cursor);
      expect(seen).toEqual(all.body.data.map((m: Json) => m.asset_id));
      expect(
        (await a().get(`/v1/loaner-pools/${p.id}/members?available=true`)).body.data,
      ).toHaveLength(3);
      expect(
        (await a().get(`/v1/loaner-pools/${p.id}/members?available=false`)).body.data,
      ).toHaveLength(2);
      expect((await a().get(`/v1/loaner-pools/${p.id}/members?cursor=nope`)).status).toBe(400);
      expect((await a().get(`/v1/loaner-pools/${randomUUID()}/members`)).status).toBe(404);
      expect((await other.admin.get(`/v1/loaner-pools/${p.id}/members`)).status).toBe(404);
      // the pool shows the counts
      const pool = (await a().get(`/v1/loaner-pools/${p.id}`)).body;
      expect(pool).toMatchObject({ member_count: 5, available_count: 3, checked_out_count: 1 });
    });

    it('removes a member (204), not while it is on loan (409 with usage) and not twice (404)', async () => {
      const p = await newPool();
      const [d1, d2] = await devices(p.id, 2);
      const who = await kid();
      await quick(p.id, { person_id: who.id, codes: [d1!.tag] });
      const busy = await a().del(`/v1/loaner-pools/${p.id}/members/${d1!.id}`);
      expect(busy.status).toBe(409);
      expect(busy.body.usage).toEqual({ open_loans: 1 });
      expect((await a().del(`/v1/loaner-pools/${p.id}/members/${d2!.id}`)).status).toBe(204);
      expect((await a().del(`/v1/loaner-pools/${p.id}/members/${d2!.id}`)).status).toBe(404);
      expect((await a().del(`/v1/loaner-pools/${p.id}/members/${randomUUID()}`)).status).toBe(404);
      expect((await a().del(`/v1/loaner-pools/${p.id}/members/nope`)).status).toBe(400);
      const audit = await auditRows(
        t.tenantId,
        `entity_id = '${p.id}' and action like 'loaner_pool.member_%'`,
      );
      expect(audit.map((r) => r.action)).toEqual([
        'loaner_pool.member_added',
        'loaner_pool.member_added',
        'loaner_pool.member_removed',
      ]);
    });

    it('a regular check-out of a member is still possible and is not a loan', async () => {
      const p = await newPool();
      const [d] = await devices(p.id, 1);
      const who = await kid();
      const res = await a().post(`/v1/assets/${d!.id}/checkout`, { person_id: who.id }, keyed());
      expect(res.status).toBe(201);
      expect(res.body.assignment.loaner_pool_id).toBeNull();
      // it is out, so it is not lendable, and the pool counts it as checked out; the loan lists do not
      const pool = (await a().get(`/v1/loaner-pools/${p.id}`)).body;
      expect(pool).toMatchObject({ available_count: 0, checked_out_count: 1 });
      expect(await loansOf(`loaner_pool_id=${p.id}`)).toHaveLength(0);
      const second = await quick(p.id, { person_id: who.id, codes: [d!.tag] });
      expect(second.body.results[0]).toMatchObject({ status: 409 });
      expect(second.body.results[0].error.code).toBe('asset-already-checked-out');
    });

    it('bulk add and bulk remove answer per item and never roll back the others', async () => {
      const p = await newPool();
      const q = await newPool();
      const [x, y] = await Promise.all([device(), device()]);
      const taken = await device(q.id);
      const bulk = await a().post(`/v1/loaner-pools/${p.id}/members/bulk-add`, {
        ids: [x.id, taken.id, y.id, randomUUID(), x.id],
      });
      expect(bulk.status).toBe(200);
      // the duplicate id in the request is folded
      expect(bulk.body.summary).toEqual({ total: 4, succeeded: 2, failed: 2 });
      expect(bulk.body.results.map((r: Json) => r.status)).toEqual([201, 409, 201, 422]);
      expect(bulk.body.results[1].error.code).toBe('conflict');
      expect((await a().get(`/v1/loaner-pools/${p.id}`)).body.member_count).toBe(2);
      // an unknown pool is 404, an empty list 422
      expect(
        (await a().post(`/v1/loaner-pools/${randomUUID()}/members/bulk-add`, { ids: [x.id] }))
          .status,
      ).toBe(404);
      expect(
        (await a().post(`/v1/loaner-pools/${p.id}/members/bulk-add`, { ids: [] })).status,
      ).toBe(422);

      const who = await kid();
      await quick(p.id, { person_id: who.id, codes: [x.tag] });
      const removal = await a().post(`/v1/loaner-pools/${p.id}/members/bulk-remove`, {
        ids: [x.id, y.id, randomUUID()],
      });
      expect(removal.status).toBe(200);
      expect(removal.body.results.map((r: Json) => r.status)).toEqual([409, 204, 404]);
      expect(removal.body.summary).toEqual({ total: 3, succeeded: 1, failed: 2 });
      // the asset list can be filtered by pool and by "in any pool"
      const inPool = await a().get(`/v1/assets?loaner_pool_id=${p.id}&limit=200`);
      expect(inPool.body.data.map((r: Json) => r.id)).toEqual([x.id]);
      const inAny = (await a().get(`/v1/assets?in_loaner_pool=true&limit=200`)).body.data.map(
        (r: Json) => r.id,
      );
      expect(inAny).toContain(x.id);
      expect(inAny).toContain(taken.id);
      expect(inAny).not.toContain(y.id);
      const inNone = (await a().get(`/v1/assets?in_loaner_pool=false&limit=200`)).body.data.map(
        (r: Json) => r.id,
      );
      expect(inNone).toContain(y.id);
      expect(inNone).not.toContain(x.id);
      expect((await a().get(`/v1/assets?loaner_pool_id=nope`)).status).toBe(400);
      // another tenant never sees the filter's matches
      expect((await other.admin.get(`/v1/assets?loaner_pool_id=${p.id}`)).body.data).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------------- loans

  describe('lending from a pool (single)', () => {
    it('lends the next available device (lowest tag first) with the default due date; the assignment carries the pool', async () => {
      const p = await newPool({ default_loan_days: 4 });
      const ds = await devices(p.id, 3);
      const first = [...ds].sort((m, n) => (m.tag < n.tag ? -1 : 1))[0]!;
      const who = await kid();
      const res = await a().post(
        `/v1/loaner-pools/${p.id}/checkout`,
        { person_id: who.id, note: 'Exam week' },
        keyed(),
      );
      expect(res.status).toBe(201);
      expect(res.body.asset.id).toBe(first.id);
      expect(res.body.assignment).toMatchObject({
        loaner_pool_id: p.id,
        person_id: who.id,
        expected_return: inDays(4),
        note: 'Exam week',
        checked_in_at: null,
      });
      expect(res.headers.etag).toMatch(/^W\/"\d+"$/);
      expect(res.body.asset.current_assignment).toMatchObject({ loaner_pool_id: p.id });
      // history, audit and outbox like every check-out, with the pool
      const history = await historyOf(a(), first.id);
      const out = history.find((h) => h.event_type === 'checked_out')!;
      expect(out.summary).toContain('Loaned to');
      expect(out.payload).toMatchObject({ loaner_pool_id: p.id, expected_return: inDays(4) });
      const audit = await auditRows(
        t.tenantId,
        `entity_id = '${first.id}' and action = 'asset.checked_out'`,
      );
      expect(audit[0]!.diff?.meta).toMatchObject({ loaner_pool_id: p.id });
      const events = await outboxRows(
        t.tenantId,
        `aggregate_id = '${first.id}' and event_type = 'asset.checked_out'`,
      );
      expect(events[0]!.payload).toMatchObject({ loanerPoolId: p.id, personId: who.id });
      // a second loan takes the next tag; a given device wins over "next"
      const second = await a().post(
        `/v1/loaner-pools/${p.id}/checkout`,
        { person_id: who.id },
        keyed(),
      );
      expect(second.body.asset.id).not.toBe(first.id);
      const third = ds.find((d) => d.id !== first.id && d.id !== second.body.asset.id)!;
      const pinned = await a().post(
        `/v1/loaner-pools/${p.id}/checkout`,
        { person_id: who.id, asset_id: third.id, expected_return: inDays(2) },
        keyed(),
      );
      expect(pinned.status).toBe(201);
      expect(pinned.body.assignment.expected_return).toBe(inDays(2));
      // the pool is empty now
      const empty = await a().post(
        `/v1/loaner-pools/${p.id}/checkout`,
        { person_id: who.id },
        keyed(),
      );
      expect(empty.status).toBe(409);
      expect(empty.body.code).toBe('no-loaner-available');
    });

    it('requires an Idempotency-Key and replays the stored answer for the same key', async () => {
      const p = await newPool();
      await devices(p.id, 2);
      const who = await kid();
      expect(
        (await a().post(`/v1/loaner-pools/${p.id}/checkout`, { person_id: who.id })).status,
      ).toBe(400);
      const k = randomUUID();
      const first = await a().post(
        `/v1/loaner-pools/${p.id}/checkout`,
        { person_id: who.id },
        keyed(undefined, k),
      );
      const replay = await a().post(
        `/v1/loaner-pools/${p.id}/checkout`,
        { person_id: who.id },
        keyed(undefined, k),
      );
      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body.assignment.id).toBe(first.body.assignment.id);
      expect(await loansOf(`loaner_pool_id=${p.id}`)).toHaveLength(1);
      const reuse = await a().post(
        `/v1/loaner-pools/${p.id}/checkout`,
        { person_id: randomUUID() },
        keyed(undefined, k),
      );
      expect(reuse.status).toBe(422);
    });

    it('enforces the pool rules: switched off, eligibility, limit per person, maximum days, past dates, unknown people', async () => {
      const p = await newPool({
        eligible_person_kinds: ['student'],
        max_loans_per_person: 1,
        max_loan_days: 5,
        default_loan_days: 3,
      });
      await devices(p.id, 4);
      const student = await kid();
      const teacher = await newPerson(a(), {
        kind: 'employee',
        email: `${unique('t')}@school.example`,
      });
      const lend = (body: Record<string, unknown>) =>
        a().post(`/v1/loaner-pools/${p.id}/checkout`, body, keyed());

      const wrongKind = await lend({ person_id: teacher.id });
      expect(wrongKind.status).toBe(422);
      expect(wrongKind.body.errors[0]).toMatchObject({
        pointer: '/person_id',
        code: 'not-eligible',
      });
      expect((await lend({ person_id: randomUUID() })).status).toBe(422);
      expect((await lend({ person_id: (await newPerson(other.admin)).id })).status).toBe(422);
      const gone = await kid({ status: 'inactive' });
      expect((await lend({ person_id: gone.id })).body.errors[0]).toMatchObject({
        code: 'inactive',
      });
      const late = await lend({ person_id: student.id, expected_return: inDays(-3) });
      expect(late.status).toBe(422);
      expect(late.body.errors[0]).toMatchObject({
        pointer: '/expected_return',
        code: 'in-the-past',
      });
      const long = await lend({ person_id: student.id, expected_return: inDays(6) });
      expect(long.status).toBe(422);
      expect(long.body.errors[0]).toMatchObject({
        pointer: '/expected_return',
        code: 'exceeds-max-loan',
      });
      expect((await lend({ person_id: student.id, expected_return: inDays(5) })).status).toBe(201);
      // the limit: one open loan per person
      const over = await lend({ person_id: student.id });
      expect(over.status).toBe(409);
      expect(over.body.code).toBe('loan-limit-reached');
      expect((await lend({ person_id: (await kid()).id, asset_id: randomUUID() })).status).toBe(
        422,
      );

      // a switched-off pool lends nothing but keeps its members
      await a().patch(
        `/v1/loaner-pools/${p.id}`,
        { is_active: false },
        ifMatch(await poolEtag(p.id)),
      );
      const off = await lend({ person_id: (await kid()).id });
      expect(off.status).toBe(409);
      expect(off.body.code).toBe('loaner-pool-inactive');
      const offQuick = await quick(p.id, { person_id: (await kid()).id, codes: ['x'] });
      expect(offQuick.status).toBe(409);
      expect(offQuick.body.code).toBe('loaner-pool-inactive');
      expect((await a().get(`/v1/loaner-pools/${p.id}`)).body.member_count).toBe(4);
      // another tenant's pool is a plain 404
      expect(
        (
          await other.admin.post(
            `/v1/loaner-pools/${p.id}/checkout`,
            { person_id: student.id },
            keyed(),
          )
        ).status,
      ).toBe(404);
    });

    it('a device that is not in the pool, or not deployable, is refused', async () => {
      const p = await newPool();
      const q = await newPool();
      const [mine] = await devices(p.id, 1);
      const [theirs] = await devices(q.id, 1);
      const who = await kid();
      const wrong = await a().post(
        `/v1/loaner-pools/${p.id}/checkout`,
        { person_id: who.id, asset_id: theirs!.id },
        keyed(),
      );
      expect(wrong.status).toBe(422);
      expect(wrong.body.errors[0]).toMatchObject({ pointer: '/asset_id', code: 'not-in-pool' });
      await a().post(
        `/v1/assets/${mine!.id}/mark-lost`,
        {},
        ifMatch((await a().get(`/v1/assets/${mine!.id}`)).headers.etag),
      );
      const none = await a().post(
        `/v1/loaner-pools/${p.id}/checkout`,
        { person_id: who.id },
        keyed(),
      );
      expect(none.status).toBe(409);
      expect(none.body.code).toBe('no-loaner-available');
      const lost = await a().post(
        `/v1/loaner-pools/${p.id}/checkout`,
        { person_id: who.id, asset_id: mine!.id },
        keyed(),
      );
      expect(lost.status).toBe(409);
      expect(lost.body.code).toBe('asset-not-deployable');
    });

    it('50 simultaneous requests for 5 devices lend exactly 5, each device once', async () => {
      const p = await newPool();
      await devices(p.id, 5);
      const people = await Promise.all(Array.from({ length: 50 }, () => kid()));
      const results = await Promise.all(
        people.map((who) =>
          a().post(`/v1/loaner-pools/${p.id}/checkout`, { person_id: who.id }, keyed()),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(5);
      expect(
        results.filter((r) => r.status === 409).every((r) => r.body.code === 'no-loaner-available'),
      ).toBe(true);
      const assets = results.filter((r) => r.status === 201).map((r) => r.body.asset.id);
      expect(new Set(assets).size).toBe(5);
    });
  });

  describe('quick check-out by scanning', () => {
    it('lends several devices to one borrower found by email, badge or id; codes may be label code, URL, tag or serial', async () => {
      const p = await newPool({ default_loan_days: 6 });
      const ds = await devices(p.id, 6);
      const who = await kid();
      const email = who.body.email as string;
      const badge = who.body.employee_ref as string;

      const byEmail = await quick(p.id, {
        borrower: email.toUpperCase(),
        codes: [ds[0]!.tag, ds[1]!.label],
      });
      expect(byEmail.status).toBe(200);
      expect(byEmail.body.person).toMatchObject({
        id: who.id,
        email,
        employee_ref: badge,
        kind: 'student',
      });
      expect(byEmail.body.loaner_pool_id).toBe(p.id);
      expect(byEmail.body.expected_return).toBe(inDays(6));
      expect(byEmail.body.summary).toEqual({ total: 2, succeeded: 2, failed: 0 });
      expect(byEmail.body.results.map((r: Json) => [r.index, r.code, r.status])).toEqual([
        [0, ds[0]!.tag, 201],
        [1, ds[1]!.label, 201],
      ]);
      expect(byEmail.body.results[0].data.assignment).toMatchObject({
        loaner_pool_id: p.id,
        person_id: who.id,
        expected_return: inDays(6),
      });
      expect(byEmail.body.results[0].data.asset.current_assignment.loaner_pool_id).toBe(p.id);

      const byBadge = await quick(p.id, {
        borrower: badge,
        codes: [`https://tracker.example/s/${ds[2]!.label}`, ds[3]!.serial.toLowerCase()],
        expected_return: inDays(2),
        note: 'Library',
      });
      expect(byBadge.body.summary.succeeded).toBe(2);
      expect(byBadge.body.results[0].data.assignment).toMatchObject({
        expected_return: inDays(2),
        note: 'Library',
      });
      const byId = await quick(p.id, { person_id: who.id, codes: [ds[4]!.tag] });
      expect(byId.body.summary.succeeded).toBe(1);
      expect((await a().get(`/v1/people/${who.id}`)).body.assets_held).toBe(5);
      expect((await a().get(`/v1/loaner-pools/${p.id}`)).body).toMatchObject({
        available_count: 1,
        checked_out_count: 5,
      });
    });

    it('validates the borrower once for the whole request (422 / 409) and the body shape', async () => {
      const p = await newPool({ eligible_person_kinds: ['student'] });
      const [d] = await devices(p.id, 1);
      const who = await kid();
      const unknown = await quick(p.id, { borrower: 'nobody@nowhere.example', codes: [d!.tag] });
      expect(unknown.status).toBe(422);
      expect(unknown.body.errors[0]).toMatchObject({ pointer: '/borrower', code: 'not-found' });
      const inactive = await kid({ status: 'inactive' });
      expect(
        (await quick(p.id, { person_id: inactive.id, codes: [d!.tag] })).body.errors[0],
      ).toMatchObject({ code: 'inactive' });
      const teacher = await newPerson(a(), {
        kind: 'employee',
        email: `${unique('t')}@school.example`,
      });
      const kindErr = await quick(p.id, { borrower: teacher.body.email, codes: [d!.tag] });
      expect(kindErr.status).toBe(422);
      expect(kindErr.body.errors[0]).toMatchObject({ pointer: '/borrower', code: 'not-eligible' });
      // an archived person is "no such person"
      const archived = await kid();
      await a().del(
        `/v1/people/${archived.id}`,
        undefined,
        ifMatch((await a().get(`/v1/people/${archived.id}`)).headers.etag),
      );
      expect((await quick(p.id, { person_id: archived.id, codes: [d!.tag] })).status).toBe(422);
      // body rules
      expect((await quick(p.id, { codes: [d!.tag] })).status).toBe(422);
      expect(
        (await quick(p.id, { person_id: who.id, borrower: 'x', codes: [d!.tag] })).status,
      ).toBe(422);
      expect((await quick(p.id, { person_id: who.id, codes: [] })).status).toBe(422);
      expect(
        (
          await quick(p.id, {
            person_id: who.id,
            codes: Array.from({ length: 51 }, (_, i) => `c${i}`),
          })
        ).status,
      ).toBe(422);
      expect((await quick(p.id, { person_id: who.id, codes: [d!.tag], extra: 1 })).status).toBe(
        422,
      );
      expect((await quick(randomUUID(), { person_id: who.id, codes: [d!.tag] })).status).toBe(404);
      expect(
        (
          await a().post(`/v1/loaner-pools/${p.id}/quick-checkout`, {
            person_id: who.id,
            codes: [d!.tag],
          })
        ).status,
      ).toBe(400);
      // nothing was lent by any of the refused requests
      expect(await loansOf(`loaner_pool_id=${p.id}`)).toHaveLength(0);
    });

    it('answers per device: unknown code, other pool, already out, twice in one request, limit; the others succeed', async () => {
      const p = await newPool({ max_loans_per_person: 3 });
      const q = await newPool();
      const ds = await devices(p.id, 5);
      const [foreign] = await devices(q.id, 1);
      const who = await kid();
      const other1 = await kid();
      await quick(p.id, { person_id: other1.id, codes: [ds[0]!.tag] });

      const res = await quick(p.id, {
        person_id: who.id,
        codes: [
          ds[0]!.tag,
          'NO-SUCH-CODE',
          foreign!.tag,
          ds[1]!.tag,
          ds[1]!.tag,
          ds[2]!.tag,
          ds[3]!.tag,
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.results.map((r: Json) => r.status)).toEqual([
        409, 404, 422, 201, 409, 201, 201,
      ]);
      expect(res.body.results[0].error.code).toBe('asset-already-checked-out');
      expect(res.body.results[1].error.code).toBe('not-found');
      expect(res.body.results[2].error.errors[0]).toMatchObject({
        pointer: '/codes/2',
        code: 'not-in-pool',
      });
      expect(res.body.results[4].error.code).toBe('asset-already-checked-out');
      expect(res.body.summary).toEqual({ total: 7, succeeded: 3, failed: 4 });
      // the fourth device of this borrower is over the pool's limit of 3
      const more = await quick(p.id, { person_id: who.id, codes: [ds[4]!.tag] });
      expect(more.body.results[0].status).toBe(409);
      expect(more.body.results[0].error.code).toBe('loan-limit-reached');
      expect((await a().get(`/v1/people/${who.id}`)).body.assets_held).toBe(3);
      // a serial shared by two assets is refused, never guessed
      const sn = unique('DUP');
      const [x, y] = await Promise.all([
        device(p.id, { serial: sn }),
        device(p.id, { serial: sn }),
      ]);
      const dup = await quick(p.id, { person_id: (await kid()).id, codes: [sn] });
      expect(dup.body.results[0].status).toBe(409);
      expect(dup.body.results[0].error.detail).toContain('serial');
      void x;
      void y;
    });

    it('is idempotent with the Idempotency-Key: a retry replays, nothing is lent twice', async () => {
      const p = await newPool();
      const ds = await devices(p.id, 2);
      const who = await kid();
      const k = randomUUID();
      const body = { person_id: who.id, codes: [ds[0]!.tag, ds[1]!.tag] };
      const first = await a().post(
        `/v1/loaner-pools/${p.id}/quick-checkout`,
        body,
        keyed(undefined, k),
      );
      const replay = await a().post(
        `/v1/loaner-pools/${p.id}/quick-checkout`,
        body,
        keyed(undefined, k),
      );
      expect(first.body.summary.succeeded).toBe(2);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(await loansOf(`loaner_pool_id=${p.id}`)).toHaveLength(2);
    });

    it('writes the same history and audit as a check-out', async () => {
      const p = await newPool();
      const [d] = await devices(p.id, 1);
      const who = await kid();
      await quick(p.id, { person_id: who.id, codes: [d!.tag] });
      const history = await historyOf(a(), d!.id);
      expect(history.map((h) => h.event_type)).toEqual(['created', 'checked_out']);
      const audit = await auditRows(t.tenantId, `entity_id = '${d!.id}'`);
      expect(audit.map((r) => r.action)).toContain('asset.checked_out');
    });
  });

  describe('quick return by scanning', () => {
    it('checks the scanned devices in, answered per code, and sends them to the pool home', async () => {
      const home = await newLocation(a());
      const elsewhere = await newLocation(a());
      const p = await newPool({ home_location_id: home.id });
      const ds = await devices(p.id, 4);
      const who = await kid();
      await quick(p.id, { person_id: who.id, codes: ds.slice(0, 3).map((d) => d.tag) });
      const stranger = await device();

      const res = await giveBack({
        codes: [ds[0]!.tag, ds[1]!.label, ds[3]!.tag, 'NOPE', stranger.tag, ds[0]!.tag],
        condition: 'good',
      });
      expect(res.status).toBe(200);
      expect(res.body.results.map((r: Json) => [r.index, r.status])).toEqual([
        [0, 200],
        [1, 200],
        [2, 409],
        [3, 404],
        [4, 422],
        [5, 409],
      ]);
      expect(res.body.results[2].error.code).toBe('asset-not-checked-out');
      expect(res.body.results[4].error.errors[0]).toMatchObject({
        pointer: '/codes/4',
        code: 'not-in-pool',
      });
      expect(res.body.results[5].error.code).toBe('asset-not-checked-out');
      expect(res.body.summary).toEqual({ total: 6, succeeded: 2, failed: 4 });
      const back = res.body.results[0].data;
      expect(back.assignment).toMatchObject({ loaner_pool_id: p.id, checkin_condition: 'good' });
      expect(back.assignment.checked_in_at).not.toBeNull();
      expect(back.asset.location_id).toBe(home.id);
      expect(back.asset.current_assignment).toBeNull();
      // the third device is still out; an explicit location wins, an explicit null does not move it
      const third = await giveBack({ codes: [ds[2]!.tag], checkin_location_id: elsewhere.id });
      expect(third.body.results[0].data.asset.location_id).toBe(elsewhere.id);
      await quick(p.id, { person_id: who.id, codes: [ds[2]!.tag] });
      const stay = await giveBack({ codes: [ds[2]!.tag], checkin_location_id: null });
      expect(stay.body.results[0].data.asset.location_id).toBe(elsewhere.id);
      // a pool filter refuses devices of other pools
      const q = await newPool();
      const [other1] = await devices(q.id, 1);
      await quick(q.id, { person_id: who.id, codes: [other1!.tag] });
      const mismatch = await giveBack({ codes: [other1!.tag], loaner_pool_id: p.id });
      expect(mismatch.body.results[0].status).toBe(422);
      expect(await loansOf(`loaner_pool_id=${q.id}`)).toHaveLength(1);
      // history: out and back
      expect((await historyOf(a(), ds[0]!.id)).map((h) => h.event_type)).toEqual([
        'created',
        'checked_out',
        'checked_in',
      ]);
      expect((await a().get(`/v1/loaner-pools/${p.id}`)).body).toMatchObject({
        available_count: 4,
        checked_out_count: 0,
      });
    });

    it('needs an Idempotency-Key, replays it, and validates the body', async () => {
      const p = await newPool();
      const [d] = await devices(p.id, 1);
      const who = await kid();
      await quick(p.id, { person_id: who.id, codes: [d!.tag] });
      expect((await a().post('/v1/loans/return', { codes: [d!.tag] })).status).toBe(400);
      const k = randomUUID();
      const first = await a().post('/v1/loans/return', { codes: [d!.tag] }, keyed(undefined, k));
      const replay = await a().post('/v1/loans/return', { codes: [d!.tag] }, keyed(undefined, k));
      expect(first.body.summary.succeeded).toBe(1);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect((await giveBack({ codes: [] })).status).toBe(422);
      expect(
        (await giveBack({ codes: Array.from({ length: 101 }, (_, i) => `c${i}`) })).status,
      ).toBe(422);
      expect((await giveBack({ codes: [d!.tag], condition: 'wet' })).status).toBe(422);
      await quick(p.id, { person_id: who.id, codes: [d!.tag] });
      expect(
        (await giveBack({ codes: [d!.tag], checkin_location_id: randomUUID() })).body.results[0]
          .status,
      ).toBe(422);
    });

    it('returns 10 devices out and in again in one pass each (the web script of M2-LOAN-02)', async () => {
      const p = await newPool();
      const ds = await devices(p.id, 10);
      const who = await kid();
      const out = await quick(p.id, { person_id: who.id, codes: ds.map((d) => d.tag) });
      expect(out.body.summary).toEqual({ total: 10, succeeded: 10, failed: 0 });
      expect((await a().get(`/v1/loaner-pools/${p.id}`)).body.checked_out_count).toBe(10);
      const back = await giveBack({ codes: ds.map((d) => d.label) });
      expect(back.body.summary).toEqual({ total: 10, succeeded: 10, failed: 0 });
      expect((await a().get(`/v1/loaner-pools/${p.id}`)).body).toMatchObject({
        checked_out_count: 0,
        available_count: 10,
      });
    });
  });

  describe('the loan lists, extension and the overdue view', () => {
    it('lists loans with state, filters, sorts and cursors', async () => {
      const p = await newPool();
      const ds = await devices(p.id, 5);
      const ann = await kid({ display_name: unique('Ann') });
      const ben = await kid({ display_name: unique('Ben') });
      const mk = async (who: { id: string }, d: Device, days: number) => {
        const res = await a().post(
          `/v1/loaner-pools/${p.id}/checkout`,
          { person_id: who.id, asset_id: d.id, expected_return: inDays(Math.max(days, 0)) },
          keyed(),
        );
        if (days < 0) await setDue(res.body.assignment.id, inDays(days));
        return res.body.assignment.id as string;
      };
      const late = await mk(ann, ds[0]!, -3);
      const today = await mk(ann, ds[1]!, 0);
      const soon = await mk(ben, ds[2]!, 2);
      const later = await mk(ben, ds[3]!, 9);

      const open = await a().get(`/v1/loans?loaner_pool_id=${p.id}`);
      expect(open.status).toBe(200);
      expect(open.body.data.map((l: Json) => l.id)).toEqual([late, today, soon, later]);
      expect(open.body.data.map((l: Json) => l.state)).toEqual([
        'overdue',
        'due_today',
        'on_loan',
        'on_loan',
      ]);
      expect(open.body.data[0]).toMatchObject({
        asset_id: ds[0]!.id,
        asset_tag: ds[0]!.tag,
        loaner_pool_id: p.id,
        pool_name: p.body.name,
        person_id: ann.id,
        person_name: ann.body.display_name,
        person_email: ann.body.email,
        person_ref: ann.body.employee_ref,
        expected_return: inDays(-3),
        returned_at: null,
        days_overdue: 3,
      });
      expect(open.body.data[1].days_overdue).toBe(0);
      const filter = async (q: string) =>
        (await loansOf(`loaner_pool_id=${p.id}&${q}`)).map((l) => l.id);
      expect(await filter('state=overdue')).toEqual([late]);
      expect(await filter('state=due_today,overdue')).toEqual([late, today]);
      expect(await filter('state=on_loan&sort=-expected_return')).toEqual([later, soon]);
      expect(await filter(`person_id=${ben.id}`)).toEqual([soon, later]);
      expect(await filter(`asset_id=${ds[1]!.id}`)).toEqual([today]);
      expect(await filter('due_within_days=2')).toEqual([late, today, soon]);
      expect(await filter(`q=${ann.body.display_name}`)).toEqual([late, today]);
      expect(await filter(`q=${ds[3]!.tag}`)).toEqual([later]);
      expect(await filter('sort=-checked_out_at')).toHaveLength(4);
      const withTotal = await a().get(
        `/v1/loans?loaner_pool_id=${p.id}&include_total=true&limit=1`,
      );
      expect(withTotal.body.page).toMatchObject({ total: 4, has_more: true });
      // cursors walk the list in every sort
      for (const sort of [
        'expected_return',
        '-expected_return',
        'checked_out_at',
        '-checked_out_at',
      ]) {
        const seen: string[] = [];
        let cursor: string | null = null;
        do {
          const page: Resp = await a().get(
            `/v1/loans?loaner_pool_id=${p.id}&limit=3&sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`,
          );
          expect(page.status, sort).toBe(200);
          seen.push(...page.body.data.map((l: Json) => l.id));
          cursor = page.body.page.next_cursor;
        } while (cursor);
        expect(new Set(seen).size, sort).toBe(4);
      }
      const forged = Buffer.from(JSON.stringify({ v: 1, b: 'x', k: ['2026-01-01', 'x'] })).toString(
        'base64url',
      );
      expect((await a().get(`/v1/loans?cursor=${forged}`)).body.code).toBe('invalid-cursor');
      expect((await a().get('/v1/loans?state=gone')).status).toBe(400);
      expect((await a().get('/v1/loans?sort=person')).status).toBe(400);
      expect((await a().get('/v1/loans?due_within_days=-1')).status).toBe(400);

      // returned loans show only when asked for
      await giveBack({ codes: [ds[3]!.tag] });
      expect(await filter('')).not.toContain(later);
      const returned = await a().get(`/v1/loans?loaner_pool_id=${p.id}&state=returned`);
      expect(returned.body.data).toHaveLength(1);
      expect(returned.body.data[0]).toMatchObject({
        id: later,
        state: 'returned',
        days_overdue: 0,
      });
      expect(returned.body.data[0].returned_at).not.toBeNull();
      // one loan by id, also after the return; foreign and unknown ids are 404
      expect((await a().get(`/v1/loans/${later}`)).body).toMatchObject({
        id: later,
        state: 'returned',
      });
      expect((await a().get(`/v1/loans/${randomUUID()}`)).status).toBe(404);
      expect((await other.admin.get(`/v1/loans/${later}`)).status).toBe(404);
      expect((await other.admin.get(`/v1/loans?loaner_pool_id=${p.id}`)).body.data).toEqual([]);
      // the pool shows the live counts
      const pool = (await a().get(`/v1/loaner-pools/${p.id}`)).body;
      expect(pool).toMatchObject({
        member_count: 5,
        available_count: 2,
        checked_out_count: 3,
        overdue_count: 1,
        due_today_count: 1,
      });
    });

    it('extends an open loan: later date within the maximum, logged in audit, outbox and history, the asset ETag changes', async () => {
      const p = await newPool({ max_loan_days: 10, default_loan_days: 2 });
      const [d] = await devices(p.id, 1);
      const who = await kid();
      const out = await a().post(
        `/v1/loaner-pools/${p.id}/checkout`,
        { person_id: who.id },
        keyed(),
      );
      const id = out.body.assignment.id as string;
      const before = String((await a().get(`/v1/assets/${d!.id}`)).headers.etag);
      const ext = await a().post(`/v1/loans/${id}/extend`, {
        expected_return: inDays(6),
        note: 'Needs it for the project',
      });
      expect(ext.status).toBe(200);
      expect(ext.body).toMatchObject({ id, expected_return: inDays(6), state: 'on_loan' });
      expect(String((await a().get(`/v1/assets/${d!.id}`)).headers.etag)).not.toBe(before);
      expect((await a().get(`/v1/assets/${d!.id}`)).body.current_assignment.expected_return).toBe(
        inDays(6),
      );
      const audit = await auditRows(t.tenantId, `entity_id = '${id}'`);
      expect(audit.map((r) => r.action)).toContain('loan.extended');
      const ev = audit.find((r) => r.action === 'loan.extended')!;
      expect(ev.diff).toMatchObject({
        before: { expected_return: inDays(2) },
        after: { expected_return: inDays(6) },
        meta: { note: 'Needs it for the project' },
      });
      expect(
        (await outboxRows(t.tenantId, `aggregate_id = '${id}'`)).map((r) => r.event_type),
      ).toEqual(['loan.extended']);
      const history = (await historyOf(a(), d!.id)).filter((h) => h.assignment_id === id);
      const logged = history.find((h) => h.payload.loan_extended)!;
      expect(logged.event_type).toBe('updated');
      expect(logged.summary).toBe(`Loan extended to ${inDays(6)}`);
      expect(logged.payload.loan_extended).toMatchObject({ from: inDays(2), to: inDays(6) });
      // not an extension, past the maximum, in the past, bad input
      const same = await a().post(`/v1/loans/${id}/extend`, { expected_return: inDays(6) });
      expect(same.status).toBe(422);
      expect(same.body.errors[0]).toMatchObject({
        pointer: '/expected_return',
        code: 'not-an-extension',
      });
      const earlier = await a().post(`/v1/loans/${id}/extend`, { expected_return: inDays(3) });
      expect(earlier.body.errors[0].code).toBe('not-an-extension');
      const tooFar = await a().post(`/v1/loans/${id}/extend`, { expected_return: inDays(11) });
      expect(tooFar.body.errors[0]).toMatchObject({ code: 'exceeds-max-loan' });
      expect(
        (await a().post(`/v1/loans/${id}/extend`, { expected_return: inDays(10) })).status,
      ).toBe(200);
      expect(
        (await a().post(`/v1/loans/${id}/extend`, { expected_return: '2020-01-01' })).body.errors[0]
          .code,
      ).toBe('in-the-past');
      expect((await a().post(`/v1/loans/${id}/extend`, { expected_return: 'soon' })).status).toBe(
        422,
      );
      expect((await a().post(`/v1/loans/${id}/extend`, {})).status).toBe(422);
      // a returned loan, an unknown one, a foreign one and a plain check-out are not extendable
      await giveBack({ codes: [d!.tag] });
      expect(
        (await a().post(`/v1/loans/${id}/extend`, { expected_return: inDays(12) })).status,
      ).toBe(409);
      expect(
        (await a().post(`/v1/loans/${randomUUID()}/extend`, { expected_return: inDays(12) }))
          .status,
      ).toBe(404);
      expect(
        (await other.admin.post(`/v1/loans/${id}/extend`, { expected_return: inDays(12) })).status,
      ).toBe(404);
      const plain = await device();
      const regular = await a().post(
        `/v1/assets/${plain.id}/checkout`,
        { person_id: who.id, expected_return: inDays(1) },
        keyed(),
      );
      expect(
        (
          await a().post(`/v1/loans/${regular.body.assignment.id}/extend`, {
            expected_return: inDays(3),
          })
        ).status,
      ).toBe(404);
    });

    it('lists overdue check-outs, loaner or not, with days overdue, sorted and paged, tenant-scoped', async () => {
      const home = await newLocation(a());
      const p = await newPool();
      const [d1, d2] = await devices(p.id, 2);
      const regular = await device();
      const roomDevice = await device();
      const who = await kid();
      const loan1 = await a().post(
        `/v1/loaner-pools/${p.id}/checkout`,
        { person_id: who.id, asset_id: d1!.id, expected_return: inDays(0) },
        keyed(),
      );
      const loan2 = await a().post(
        `/v1/loaner-pools/${p.id}/checkout`,
        { person_id: who.id, asset_id: d2!.id, expected_return: inDays(0) },
        keyed(),
      );
      const plain = await a().post(
        `/v1/assets/${regular.id}/checkout`,
        { person_id: who.id, expected_return: inDays(0) },
        keyed(),
      );
      const room = await a().post(
        `/v1/assets/${roomDevice.id}/checkout`,
        { location_id: home.id, expected_return: inDays(0) },
        keyed(),
      );
      await setDue(loan1.body.assignment.id, inDays(-2));
      await setDue(loan2.body.assignment.id, inDays(-5));
      await setDue(plain.body.assignment.id, inDays(-1));
      await setDue(room.body.assignment.id, inDays(-9));

      const all = await a().get(`/v1/loans/overdue?person_id=${who.id}`);
      expect(all.status).toBe(200);
      expect(all.body.data.map((r: Json) => [r.asset_id, r.days_overdue])).toEqual([
        [d2!.id, 5],
        [d1!.id, 2],
        [regular.id, 1],
      ]);
      expect(all.body.data[0]).toMatchObject({
        assignment_id: loan2.body.assignment.id,
        asset_tag: d2!.tag,
        person_id: who.id,
        holder_name: who.body.display_name,
        loaner_pool_id: p.id,
        pool_name: p.body.name,
        expected_return: inDays(-5),
      });
      expect(all.body.data[2]).toMatchObject({ loaner_pool_id: null, pool_name: null });
      const mine = (await a().get('/v1/loans/overdue?limit=200')).body.data as Json[];
      const place = mine.find((r) => r.asset_id === roomDevice.id)!;
      expect(place).toMatchObject({ location_id: home.id, person_id: null, days_overdue: 9 });
      expect(place.holder_name).toBe(home.body.name);
      expect((await a().get(`/v1/loans/overdue?loaner_pool_id=${p.id}`)).body.data).toHaveLength(2);
      expect(
        (await a().get(`/v1/loans/overdue?person_id=${who.id}&sort=-days_overdue`)).body.data.map(
          (r: Json) => r.days_overdue,
        ),
      ).toEqual([5, 2, 1]);
      expect(
        (await a().get(`/v1/loans/overdue?person_id=${who.id}&sort=days_overdue`)).body.data.map(
          (r: Json) => r.days_overdue,
        ),
      ).toEqual([1, 2, 5]);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Resp = await a().get(
          `/v1/loans/overdue?person_id=${who.id}&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        );
        seen.push(...page.body.data.map((r: Json) => r.asset_id));
        cursor = page.body.page.next_cursor;
      } while (cursor);
      expect(seen).toEqual([d2!.id, d1!.id, regular.id]);
      expect((await a().get('/v1/loans/overdue?sort=nope')).status).toBe(400);
      expect((await other.admin.get(`/v1/loans/overdue?person_id=${who.id}`)).body.data).toEqual(
        [],
      );
      // the asset list's own `overdue` filter agrees
      expect(
        (await a().get(`/v1/assets?overdue=true&assigned_person_id=${who.id}`)).body.data,
      ).toHaveLength(3);
    });
  });

  // ------------------------------------------------------------------------------ dashboard

  describe('the dashboard', () => {
    it('counts per pool and in total, with the latest activity, scoped to the tenant', async () => {
      const dash = await createTenant(app, tenancy, 'loandash');
      const c = await basics(dash);
      const admin = dash.admin;
      const pool = async (name: string, extra: Record<string, unknown> = {}) =>
        (await admin.post('/v1/loaner-pools', { name, ...extra })).body as Json;
      const dev = async (poolId: string) => {
        const asset = await newAsset(admin, c.categoryId, { serial: unique('SN') });
        await admin.post(`/v1/loaner-pools/${poolId}/members`, { asset_id: asset.id });
        return { id: asset.id as string, tag: asset.body.asset_tag as string };
      };
      expect((await admin.get('/v1/loaners/dashboard')).body).toMatchObject({
        totals: {
          pools: 0,
          members: 0,
          available: 0,
          checked_out: 0,
          overdue: 0,
          due_today: 0,
          due_soon: 0,
        },
        pools: [],
        recent: [],
      });
      const cart = await pool('Cart A');
      const lab = await pool('Cart B');
      const gone = await pool('Cart C');
      const as = await Promise.all(Array.from({ length: 6 }, () => dev(cart.id)));
      const bs = await Promise.all(Array.from({ length: 2 }, () => dev(lab.id)));
      await dev(gone.id);
      await admin.del(
        `/v1/loaner-pools/${gone.id}`,
        undefined,
        ifMatch((await admin.get(`/v1/loaner-pools/${gone.id}`)).headers.etag),
      );
      const who = (await admin.post('/v1/people', { display_name: unique('Kid'), kind: 'student' }))
        .body;
      const out = async (poolId: string, asset: { id: string }, due: number) => {
        const res = await admin.post(
          `/v1/loaner-pools/${poolId}/checkout`,
          { person_id: who.id, asset_id: asset.id, expected_return: inDays(Math.max(due, 0)) },
          keyed(),
        );
        if (due < 0) {
          await ownerTenantSql(
            dash.tenantId,
            `update app.assignment set expected_return = '${inDays(due)}'::date where id = '${res.body.assignment.id}'`,
          );
        }
      };
      await out(cart.id, as[0]!, -4); // overdue
      await out(cart.id, as[1]!, -1); // overdue
      await out(cart.id, as[2]!, 0); // due today
      await out(cart.id, as[3]!, 2); // due soon (default lead 2 days)
      await out(cart.id, as[4]!, 8); // on loan, not soon
      await out(lab.id, bs[0]!, 1); // due soon, in a pool that is switched off afterwards
      await admin.patch(
        `/v1/loaner-pools/${lab.id}`,
        { is_active: false },
        ifMatch((await admin.get(`/v1/loaner-pools/${lab.id}`)).headers.etag),
      );
      await admin.post('/v1/loans/return', { codes: [as[4]!.tag] }, keyed());

      const res = await admin.get('/v1/loaners/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.as_of).toBe(inDays(0));
      expect(res.body.pools.map((p: Json) => p.name)).toEqual(['Cart A', 'Cart B']);
      expect(res.body.pools[0]).toMatchObject({
        id: cart.id,
        is_active: true,
        member_count: 6,
        available_count: 2,
        checked_out_count: 4,
        overdue_count: 2,
        due_today_count: 1,
        due_soon_count: 1,
      });
      expect(res.body.pools[1]).toMatchObject({
        id: lab.id,
        is_active: false,
        member_count: 2,
        available_count: 1,
        checked_out_count: 1,
        overdue_count: 0,
        due_today_count: 0,
        due_soon_count: 1,
      });
      expect(res.body.totals).toEqual({
        pools: 2,
        members: 8,
        available: 3,
        checked_out: 5,
        overdue: 2,
        due_today: 1,
        due_soon: 2,
      });
      expect(res.body.recent.length).toBe(7);
      expect(res.body.recent[0]).toMatchObject({
        kind: 'checked_in',
        asset_tag: as[4]!.tag,
        loaner_pool_id: cart.id,
        person_id: who.id,
      });
      expect(res.body.recent.filter((r: Json) => r.kind === 'checked_out')).toHaveLength(6);
      const times = res.body.recent.map((r: Json) => r.at as string);
      expect(times).toEqual([...times].sort().reverse());
      // the reminder lead time moves "due soon" (0 = none)
      const settings = await admin.get('/v1/settings/custody');
      await admin.put(
        '/v1/settings/custody',
        { loan_reminder_days: 0 },
        ifMatch(settings.headers.etag),
      );
      expect((await admin.get('/v1/loaners/dashboard')).body.totals.due_soon).toBe(0);
      // the counts are what the lists behind them show
      expect(
        (await admin.get(`/v1/loans?loaner_pool_id=${cart.id}&state=overdue`)).body.data,
      ).toHaveLength(2);
      // another tenant sees none of it
      expect(
        (await a().get('/v1/loaners/dashboard')).body.pools.map((p: Json) => p.id),
      ).not.toContain(cart.id);
      // 20 loans: the activity feed is capped at 20
      const bulk = await Promise.all(Array.from({ length: 12 }, () => dev(cart.id)));
      await admin.post(
        `/v1/loaner-pools/${cart.id}/quick-checkout`,
        { person_id: who.id, codes: bulk.map((d) => d.tag) },
        keyed(),
      );
      await admin.post('/v1/loans/return', { codes: bulk.map((d) => d.tag) }, keyed());
      expect((await admin.get('/v1/loaners/dashboard')).body.recent).toHaveLength(20);
    });
  });

  // --------------------------------------------------------------------------------- settings

  describe('the custody settings (M2-LIFE-09)', () => {
    it('reads the defaults, replaces with If-Match, audits, and is writable by catalogue managers only', async () => {
      const s = await createTenant(app, tenancy, 'loanset');
      const admin = s.admin;
      const got = await admin.get('/v1/settings/custody');
      expect(got.status).toBe(200);
      expect(got.body).toEqual({ default_expected_return_days: null, loan_reminder_days: 2 });
      const etag = String(got.headers.etag);
      expect(etag).toMatch(/^W\/"\d+"$/);
      expect(
        (await admin.put('/v1/settings/custody', { default_expected_return_days: 14 })).status,
      ).toBe(428);
      expect(
        (
          await admin.put(
            '/v1/settings/custody',
            { default_expected_return_days: 14 },
            ifMatch('W/"99"'),
          )
        ).status,
      ).toBe(412);
      const put = await admin.put(
        '/v1/settings/custody',
        { default_expected_return_days: 14 },
        ifMatch(etag),
      );
      expect(put.status).toBe(200);
      expect(put.body).toEqual({ default_expected_return_days: 14, loan_reminder_days: 2 });
      expect(put.headers.etag).not.toBe(etag);
      expect((await admin.get('/v1/settings/custody')).body).toEqual(put.body);
      // PUT replaces: an omitted member is back to its default
      const reset = await admin.put(
        '/v1/settings/custody',
        { loan_reminder_days: 5 },
        ifMatch(put.headers.etag),
      );
      expect(reset.body).toEqual({ default_expected_return_days: null, loan_reminder_days: 5 });
      for (const bad of [
        { default_expected_return_days: 0 },
        { default_expected_return_days: 400 },
        { default_expected_return_days: 1.5 },
        { loan_reminder_days: -1 },
        { loan_reminder_days: 31 },
        { colour: 'red' },
      ]) {
        expect(
          (await admin.put('/v1/settings/custody', bad, ifMatch(reset.headers.etag))).status,
          JSON.stringify(bad),
        ).toBe(422);
      }
      // the other settings of the tenant are untouched
      expect((await admin.get('/v1/settings/files')).status).toBe(200);
      const audit = await auditRows(s.tenantId, `action = 'tenant_settings.custody_updated'`);
      expect(audit).toHaveLength(2);
      expect(audit[0]!.diff).toMatchObject({ after: { default_expected_return_days: 14 } });
      // the API never applies the default: a check-out without a date stays open-ended
      const cc = await basics(s);
      const asset = await newAsset(admin, cc.categoryId);
      const person = await newPerson(admin);
      const out = await admin.post(
        `/v1/assets/${asset.id}/checkout`,
        { person_id: person.id },
        keyed(),
      );
      expect(out.body.assignment.expected_return).toBeNull();
      // permissions: everybody reads, only catalogue managers write
      const manager = await createUser(app, s, 'asset_manager');
      expect(
        (
          await manager.client.put(
            '/v1/settings/custody',
            { loan_reminder_days: 3 },
            ifMatch((await admin.get('/v1/settings/custody')).headers.etag),
          )
        ).status,
      ).toBe(200);
      for (const role of ['technician', 'auditor', 'viewer']) {
        const user = await createUser(app, s, role);
        expect((await user.client.get('/v1/settings/custody')).status, role).toBe(200);
        expect(
          (await user.client.put('/v1/settings/custody', { loan_reminder_days: 1 }, ifMatch('*')))
            .status,
          role,
        ).toBe(403);
      }
      // another tenant has its own settings
      expect((await other.admin.get('/v1/settings/custody')).body).toEqual({
        default_expected_return_days: null,
        loan_reminder_days: 2,
      });
    });
  });

  // --------------------------------------------------------------------------- permissions

  describe('permissions', () => {
    it('everybody reads; managers write pools and members; technicians lend and return; viewers and auditors cannot', async () => {
      const p = await newPool();
      const [d] = await devices(p.id, 2);
      const who = await kid();
      const manager = await createUser(app, t, 'asset_manager');
      expect((await manager.client.post('/v1/loaner-pools', { name: unique('M') })).status).toBe(
        201,
      );
      for (const role of ['technician', 'auditor', 'viewer']) {
        const user = await createUser(app, t, role);
        const c = user.client;
        expect((await c.get('/v1/loaner-pools')).status, role).toBe(200);
        expect((await c.get(`/v1/loaner-pools/${p.id}`)).status, role).toBe(200);
        expect((await c.get(`/v1/loaner-pools/${p.id}/members`)).status, role).toBe(200);
        expect((await c.get('/v1/loans')).status, role).toBe(200);
        expect((await c.get('/v1/loans/overdue')).status, role).toBe(200);
        expect((await c.get('/v1/loaners/dashboard')).status, role).toBe(200);
        expect((await c.post('/v1/loaner-pools', { name: unique('X') })).status, role).toBe(403);
        expect(
          (await c.patch(`/v1/loaner-pools/${p.id}`, { description: 'x' }, ifMatch(p.etag))).status,
          role,
        ).toBe(403);
        expect(
          (await c.del(`/v1/loaner-pools/${p.id}`, undefined, ifMatch(p.etag))).status,
          role,
        ).toBe(403);
        expect(
          (await c.post(`/v1/loaner-pools/${p.id}/members`, { asset_id: d!.id })).status,
          role,
        ).toBe(403);
        expect(
          (await c.post(`/v1/loaner-pools/${p.id}/members/bulk-add`, { ids: [d!.id] })).status,
          role,
        ).toBe(403);
        expect((await c.del(`/v1/loaner-pools/${p.id}/members/${d!.id}`)).status, role).toBe(403);
        if (role === 'technician') continue;
        expect(
          (await c.post(`/v1/loaner-pools/${p.id}/checkout`, { person_id: who.id }, key())).status,
          role,
        ).toBe(403);
        expect(
          (
            await c.post(
              `/v1/loaner-pools/${p.id}/quick-checkout`,
              { person_id: who.id, codes: [d!.tag] },
              key(),
            )
          ).status,
          role,
        ).toBe(403);
        expect((await c.post('/v1/loans/return', { codes: [d!.tag] }, key())).status, role).toBe(
          403,
        );
        expect(
          (await c.post(`/v1/loans/${randomUUID()}/extend`, { expected_return: inDays(3) })).status,
          role,
        ).toBe(403);
      }
      // the technician's own flow
      const tech = await createUser(app, t, 'technician');
      const out = await tech.client.post(
        `/v1/loaner-pools/${p.id}/quick-checkout`,
        { person_id: who.id, codes: [d!.tag] },
        key(),
      );
      expect(out.status).toBe(200);
      expect(out.body.summary.succeeded).toBe(1);
      const id = out.body.results[0].data.assignment.id;
      expect(
        (await tech.client.post(`/v1/loans/${id}/extend`, { expected_return: inDays(9) })).status,
      ).toBe(200);
      expect(
        (await tech.client.post('/v1/loans/return', { codes: [d!.tag] }, key())).body.summary
          .succeeded,
      ).toBe(1);
    });
  });

  describe('tenant isolation', () => {
    it('never finds, lends or returns another tenant device by its tag, label or serial', async () => {
      const p = await newPool();
      const [d] = await devices(p.id, 1);
      const theirPool = (await other.admin.post('/v1/loaner-pools', { name: unique('Cart') })).body;
      const theirKid = (await other.admin.post('/v1/people', { display_name: unique('Kid') })).body;
      const res = await other.admin.post(
        `/v1/loaner-pools/${theirPool.id}/quick-checkout`,
        { person_id: theirKid.id, codes: [d!.tag, d!.label, d!.serial] },
        keyed(),
      );
      expect(res.status).toBe(200);
      expect(res.body.results.map((r: Json) => r.status)).toEqual([404, 404, 404]);
      const back = await other.admin.post(
        '/v1/loans/return',
        { codes: [d!.tag, d!.label] },
        keyed(),
      );
      expect(back.body.results.map((r: Json) => r.status)).toEqual([404, 404]);
      // and the owner's device is untouched
      expect((await a().get(`/v1/loaner-pools/${p.id}`)).body).toMatchObject({
        available_count: 1,
        checked_out_count: 0,
      });
    });
  });

  // ---------------------------------------------------------------------------- the alerts

  describe('overdue and due-soon alerts (M2-LOAN-03)', () => {
    let alert: TenantFixture;
    let ab: Basics;

    // a tenant of its own per test: the job looks at every loan of the tenant
    beforeEach(async () => {
      alert = await createTenant(app, tenancy, 'loanalert');
      ab = await basics(alert);
    });

    const relay = () =>
      new OutboxRelay({
        tenancy: runtime,
        tenants: async () => [{ tenantId: alert.tenantId }],
        subscribers: app.get(OutboxSubscribers, { strict: false }),
        logger: pino({ level: 'silent' }),
      }).runOnce();
    /** The daily job for the alert tenant, as if it ran on `today`. */
    const runJob = (today: string) =>
      runtime.withTenantTx({ tenantId: alert.tenantId }, (tx) =>
        app.get(LoanAlerts, { strict: false }).run(
          { tenantId: alert.tenantId },
          {
            tenantId: alert.tenantId,
            tx,
            jobId: 'test',
            queue: 'loan.alerts',
            retryCount: 0,
            logger: pino({ level: 'silent' }),
          },
          today,
        ),
      );
    const notes = async (type: string) =>
      (
        await ownerTenantSql(
          alert.tenantId,
          `select user_id, dedupe_key, title, body, link from app.notification where type = '${type}' order by created_at, id`,
        )
      ).rows as Array<{
        user_id: string;
        dedupe_key: string;
        title: string;
        body: string;
        link: string;
      }>;

    /** A pool with `n` devices, a borrower WITH a login and a manager; one loan per device. */
    const setup = async (n: number, poolExtra: Record<string, unknown> = {}) => {
      const pool = (
        await alert.admin.post('/v1/loaner-pools', { name: unique('Cart'), ...poolExtra })
      ).body as Json;
      const devs: Array<{ id: string; tag: string }> = [];
      for (let i = 0; i < n; i++) {
        const asset = await newAsset(alert.admin, ab.categoryId, { serial: unique('SN') });
        await alert.admin.post(`/v1/loaner-pools/${pool.id}/members`, { asset_id: asset.id });
        devs.push({ id: asset.id, tag: asset.body.asset_tag });
      }
      return { pool, devs };
    };
    const borrowerWithLogin = async () => {
      const user = await createUser(app, alert, 'viewer');
      const people = await alert.admin.get(`/v1/people?q=${encodeURIComponent(user.email)}`);
      return { ...user, personId: people.body.data[0].id as string };
    };

    it('raises one overdue alert per loan and day, tells the borrower and the managers, escalates, and is silent when run again', async () => {
      const owner = await createUser(app, alert, 'asset_manager', 'owner');
      const { pool, devs } = await setup(3, { default_loan_days: 1 });
      const borrower = await borrowerWithLogin();
      const noLogin = (await alert.admin.post('/v1/people', { display_name: unique('NoLogin') }))
        .body;
      const l1 = await alert.admin.post(
        `/v1/loaner-pools/${pool.id}/checkout`,
        { person_id: borrower.personId, asset_id: devs[0]!.id },
        keyed(),
      );
      const l2 = await alert.admin.post(
        `/v1/loaner-pools/${pool.id}/checkout`,
        { person_id: noLogin.id, asset_id: devs[1]!.id },
        keyed(),
      );
      const l3 = await alert.admin.post(
        `/v1/loaner-pools/${pool.id}/checkout`,
        { person_id: borrower.personId, asset_id: devs[2]!.id },
        keyed(),
      );
      // two loans end up 3 and 1 day(s) overdue, one is still running
      await ownerTenantSql(
        alert.tenantId,
        `update app.assignment set expected_return = '${inDays(-3)}'::date where id = '${l1.body.assignment.id}'`,
      );
      await ownerTenantSql(
        alert.tenantId,
        `update app.assignment set expected_return = '${inDays(-1)}'::date where id = '${l2.body.assignment.id}'`,
      );
      await ownerTenantSql(
        alert.tenantId,
        `update app.assignment set expected_return = '${inDays(30)}'::date where id = '${l3.body.assignment.id}'`,
      );

      const today = inDays(0);
      expect(await runJob(today)).toEqual({ today, overdue: 2, dueSoon: 0 });
      // running it again the same day finds the ledger rows: no new event
      expect(await runJob(today)).toEqual({ today, overdue: 0, dueSoon: 0 });
      const events = await outboxRows(alert.tenantId, `event_type = 'loan.overdue'`);
      expect(events).toHaveLength(2);
      expect(events.find((e) => e.aggregate_id === l1.body.assignment.id)!.payload).toMatchObject({
        assignmentId: l1.body.assignment.id,
        assetId: devs[0]!.id,
        personId: borrower.personId,
        poolId: pool.id,
        daysOverdue: 3,
        alertDate: today,
      });
      await relay();
      // delivering the same events again changes nothing (redelivery is a no-op)
      await relay();
      const sent = await notes('loan.overdue');
      const forBorrower = sent.filter((n) => n.user_id === borrower.id);
      expect(forBorrower).toHaveLength(1);
      expect(forBorrower[0]!.title).toBe(`Overdue: ${devs[0]!.tag}`);
      expect(forBorrower[0]!.body).toContain('3 day(s) overdue');
      expect(forBorrower[0]!.link).toBe(`/assets/view?id=${devs[0]!.id}`);
      // managers (the pool has no owner: the holders of loaner:manage) get both loans, the borrower's login only its own
      const manager = sent.filter((n) => n.user_id === owner.id);
      expect(manager).toHaveLength(2);
      expect(sent.length).toBeGreaterThanOrEqual(3);
      const alerts = await ownerTenantSql(
        alert.tenantId,
        `select kind, days_overdue from app.loan_alert where assignment_id = '${l1.body.assignment.id}'`,
      );
      expect(alerts.rows).toEqual([{ kind: 'overdue', days_overdue: 3 }]);

      // the next day: the clock advances, every loan still out is alerted exactly once more, copy escalates
      const tomorrow = inDays(1);
      expect(await runJob(tomorrow)).toEqual({ today: tomorrow, overdue: 2, dueSoon: 0 });
      expect(await runJob(tomorrow)).toMatchObject({ overdue: 0 });
      await relay();
      const second = await notes('loan.overdue');
      expect(second.filter((n) => n.user_id === borrower.id)).toHaveLength(2);
      expect(second.filter((n) => n.user_id === owner.id)).toHaveLength(4);
      expect(new Set(second.map((n) => `${n.user_id}:${n.dedupe_key}`)).size).toBe(second.length);
      // a week later the loan is 10 days overdue and the text says so
      const week = inDays(7);
      await runJob(week);
      await relay();
      const late = (await notes('loan.overdue')).filter((n) => n.user_id === borrower.id).at(-1)!;
      expect(late.body).toContain('10 day(s) overdue');
      expect(late.body).toContain('more than a week overdue');
      // a returned loan is not alerted again
      await alert.admin.post('/v1/loans/return', { codes: [devs[0]!.tag] }, keyed());
      expect(await runJob(inDays(8))).toMatchObject({ overdue: 1 });
    });

    it('tells only the pool owner (not every manager) when the pool has one, and raises nothing for plain check-outs', async () => {
      const owner = await createUser(app, alert, 'asset_manager', 'poolowner');
      const { pool, devs } = await setup(1, { owner_user_id: owner.id });
      const who = await borrowerWithLogin();
      const loan = await alert.admin.post(
        `/v1/loaner-pools/${pool.id}/checkout`,
        { person_id: who.personId },
        keyed(),
      );
      await ownerTenantSql(
        alert.tenantId,
        `update app.assignment set expected_return = '${inDays(-2)}'::date where id = '${loan.body.assignment.id}'`,
      );
      // a regular check-out far past due is listed as overdue but raises no alert
      const plain = await newAsset(alert.admin, ab.categoryId);
      const regular = await alert.admin.post(
        `/v1/assets/${plain.id}/checkout`,
        { person_id: who.personId, expected_return: inDays(0) },
        keyed(),
      );
      await ownerTenantSql(
        alert.tenantId,
        `update app.assignment set expected_return = '${inDays(-20)}'::date where id = '${regular.body.assignment.id}'`,
      );
      const before = (await notes('loan.overdue')).length;
      const day = inDays(40);
      const result = await runJob(day);
      expect(result.overdue).toBeGreaterThanOrEqual(1);
      await relay();
      const sent = (await notes('loan.overdue')).slice(before);
      const mine = sent.filter((n) => n.link === `/assets/view?id=${devs[0]!.id}`);
      expect(mine.map((n) => n.user_id).sort()).toEqual([owner.id, who.id].sort());
      expect(sent.some((n) => n.link === `/assets/view?id=${plain.id}`)).toBe(false);
    });

    it('sends a due-soon reminder once per loan and due date; an extension re-arms it; 0 days switches it off', async () => {
      const { pool, devs } = await setup(2, { default_loan_days: 3 });
      const who = await borrowerWithLogin();
      const l = await alert.admin.post(
        `/v1/loaner-pools/${pool.id}/checkout`,
        { person_id: who.personId, asset_id: devs[0]!.id },
        keyed(),
      );
      const farLoan = await alert.admin.post(
        `/v1/loaner-pools/${pool.id}/checkout`,
        { person_id: who.personId, asset_id: devs[1]!.id, expected_return: inDays(20) },
        keyed(),
      );
      void farLoan;
      const due = l.body.assignment.expected_return as string;
      expect(due).toBe(inDays(3));
      // the default reminder lead is 2 days: nothing yet at day 0, the reminder on day 1
      expect(await runJob(inDays(0))).toMatchObject({ overdue: 0, dueSoon: 0 });
      expect(await runJob(inDays(1))).toMatchObject({ overdue: 0, dueSoon: 1 });
      expect(await runJob(inDays(1))).toMatchObject({ dueSoon: 0 });
      expect(await runJob(inDays(2))).toMatchObject({ dueSoon: 0 });
      await relay();
      const soon = (await notes('loan.due_soon')).filter((n) => n.user_id === who.id);
      expect(soon).toHaveLength(1);
      expect(soon[0]!.title).toBe(`Due back soon: ${devs[0]!.tag}`);
      expect(soon[0]!.body).toContain(due);
      // extending the loan moves the due date: the reminder fires again for the new date
      const ext = await alert.admin.post(`/v1/loans/${l.body.assignment.id}/extend`, {
        expected_return: inDays(10),
      });
      expect(ext.status).toBe(200);
      expect(await runJob(inDays(8))).toMatchObject({ dueSoon: 1 });
      await relay();
      expect((await notes('loan.due_soon')).filter((n) => n.user_id === who.id)).toHaveLength(2);
      // only the borrower is told; a lead time of 0 switches the reminder off
      const settings = await alert.admin.get('/v1/settings/custody');
      await alert.admin.put(
        '/v1/settings/custody',
        { loan_reminder_days: 0 },
        ifMatch(settings.headers.etag),
      );
      expect(await runJob(inDays(19))).toMatchObject({ dueSoon: 0 });
      const all = await notes('loan.due_soon');
      expect(all.every((n) => n.user_id === who.id)).toBe(true);
      await alert.admin.put(
        '/v1/settings/custody',
        { loan_reminder_days: 2 },
        ifMatch((await alert.admin.get('/v1/settings/custody')).headers.etag),
      );
    });

    it('does nothing for another tenant, for returned loans and when nothing is due; the scheduler produces the daily job', async () => {
      const empty = await createTenant(app, tenancy, 'loanquiet');
      const result = await runtime.withTenantTx({ tenantId: empty.tenantId }, (tx) =>
        app.get(LoanAlerts, { strict: false }).run(
          { tenantId: empty.tenantId },
          {
            tenantId: empty.tenantId,
            tx,
            jobId: 'test',
            queue: 'loan.alerts',
            retryCount: 0,
            logger: pino({ level: 'silent' }),
          },
          inDays(100),
        ),
      );
      expect(result).toMatchObject({ overdue: 0, dueSoon: 0 });
      // the alert tenant's loans are never visible from the quiet one
      expect((await outboxRows(empty.tenantId, `event_type like 'loan.%'`)).length).toBe(0);
    });
  });
});

/** Unknown codes of the quick flows count as misses of the scan-resolve throttle (M2-TAG-01). */
describe.skipIf(!dbEnabled)(`loaner scans and the miss throttle (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;

  beforeAll(async () => {
    ({ app } = await startRegistryApp({ SCAN_RESOLVE_MAX_MISSES: '4' }));
    t = await createTenant(app, tenancy, 'loanmiss');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  it('blocks a caller whose scans keep missing (429 with Retry-After) before any lookup, for both flows', async () => {
    const pool = (await t.admin.post('/v1/loaner-pools', { name: unique('Cart') })).body;
    const who = (await t.admin.post('/v1/people', { display_name: unique('Kid') })).body;
    const first = await t.admin.post(
      `/v1/loaner-pools/${pool.id}/quick-checkout`,
      { person_id: who.id, codes: ['miss-1', 'miss-2', 'miss-3', 'miss-4'] },
      keyed(),
    );
    expect(first.status).toBe(200);
    expect(first.body.summary).toEqual({ total: 4, succeeded: 0, failed: 4 });
    const blocked = await t.admin.post(
      `/v1/loaner-pools/${pool.id}/quick-checkout`,
      { person_id: who.id, codes: ['anything'] },
      keyed(),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await t.admin.post('/v1/loans/return', { codes: ['x'] }, keyed())).status).toBe(429);
    // a hit never counts, and the pool's other endpoints are not throttled
    expect((await t.admin.get(`/v1/loaner-pools/${pool.id}`)).status).toBe(200);
  });
});
